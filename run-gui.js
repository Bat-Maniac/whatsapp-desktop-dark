const fs = require('fs-extra');
const nodefs = require("fs");
const ps = require('ps-node');
const request = require('https').request;
const {URL} = require('url');
const semver = require('semver');
const asar = require('asar');
const path = require('path');
const {spawn} = require("child_process");
const open = require('open');
const express = require('express');
const xApp = express();
let io = require('socket.io');

let client = null;
let version = '0';
let started = false;
let updURL = 'https://raw.githubusercontent.com/m4heshd/whatsapp-desktop-dark/master/package.json';
let bkPath = path.join(__dirname, 'backup', 'app.asar');
let WAPath = null;
let platform = process.platform;
let execPath = '/Applications/WhatsApp.app/Contents/MacOS/WhatsApp';
let command = 'WhatsApp.exe';
let psargs = 'ux';

if (platform === 'darwin') {
    WAPath = '/Applications/WhatsApp.app/Contents/Resources/app.asar';
    command = execPath;
    psargs = 'ax';
}

//Backend setup
exports.startGUI = function () {
    xApp.use(express.static(path.join(__dirname, 'gui')));

    let xServ = xApp.listen(3210, function () {
        console.log('WADark GUI installer backend started');
        openInstaller();
    });

    io = io(xServ, {
        pingTimeout: 90000
    });

    io.on('connection', function (socket) {
        if (!started) {
            client = socket;
            console.log('WADark installer client connected. ID - ' + socket.id);

            //Incoming messages
            client.on('startInstall', function () {
                setOLTxt('Identifying process..');
                if (fs.existsSync(bkPath)) {
                    ask('Current backup will be replaced and it cannot be undone. Are you sure want to continue?', function () {
                        validateAndStart(false);
                    }, function () {
                        say('Hope you\'re enjoying WhatsApp dark.. :)');
                        hideOL();
                    });
                } else {
                    validateAndStart(false);
                }
            });

            client.on('startRestore', function () {
                setOLTxt('Identifying process..');
                if (fs.existsSync(bkPath)) {
                    validateAndStart(true);
                } else {
                    say('Unable to locate the backup file');
                    hideOL();
                }
            });

            client.on('endApp', function () {
                console.log('Quitting the installer..\n');
                client.disconnect();
                process.exit(0);
            });

            client.on('checkUpd', function () {
                checkAppUpd(false);
            });

            if (platform === 'darwin') {
                setMacUI();
            }

            startInit();
        } else {
            console.log('Client connection rejected. ID - ' + socket.id);
            socket.emit('setOLTxt', 'One instance of the process is already running.. Please restart if this is an error.');
        }
    });
};

//Backend functions
function startInit() {
    showOL('Reading version info..');
    fs.readJson(path.join(__dirname, 'info.json'), (error, infoJSON) => {
        if (!error) {
            version = infoJSON.version;
            // version = "0.3.4940";
            setVersion('v' + version);
            checkAppUpd(true);
        } else {
            console.log(error);
            start();
        }
    });
}

function checkAppUpd(isStart) {
    showOL('Checking for updates..');
    let req = request(new URL(updURL), function (res) {

        res.on('data', (d) => {
            let latest = JSON.parse(d.toString())['version'];
            if (semver.lt(version, latest)) {
                ask('A new update is available (v' + latest + '). Would you like to download?', openDownload, start);
            } else {
                if (isStart) {
                    start();
                } else {
                    hideOL();
                    say('Your script copy is up to date.');
                }
            }
        });
    });

    req.on('error', (e) => {
        console.log(e);
        if (isStart) {
            start();
        } else {
            hideOL();
        }
    });

    req.end();
}

function start() {
    endInit(fs.existsSync(bkPath));
}

function validateAndStart(isRestore) {
    if (platform === 'darwin') {
        if (fs.existsSync(WAPath)) {
            startInstall(isRestore);
        } else {
            say('Unable to locate your WhatsApp Desktop installation. Check again and retry.');
            hideOL();
        }
    } else {
        startInstall(isRestore);
    }
}

function startInstall(isRestore) {
    started = true;
    ps.lookup({
        command: command,
        psargs: psargs
    }, function (err, resultList) {
        if (err) {
            console.log(err);
        } else {
            if (resultList.length) {
                setOLTxt('Please close WhatsApp Desktop manually to continue installation.. </br>(Please wait if you already have)');
                if (platform === 'win32') {
                    WAPath = resultList[0].command;
                    execPath = WAPath;
                }
                startInstall(isRestore);
            } else {
                if (WAPath) {
                    if (isRestore) {
                        restoreBackup(WAPath);
                    } else {
                        applyDarkStyles(WAPath);
                    }
                } else {
                    say('WhatsApp process not found. Make sure WhatsApp desktop is running before installing dark mode.');
                    hideOL();
                    started = false;
                }
            }

        }
    });
}

function applyDarkStyles(procPath) {
    try {
        let dir = path.dirname(procPath);
        let fullpath = path.join(dir, 'resources', 'app.asar');

        if (platform === 'darwin') {
            fullpath = procPath;
        }

        setOLTxt('Backing up..');
        fs.copySync(fullpath, bkPath);

        setOLTxt('Extracting..');
        let extPath = path.join(__dirname, 'extracted');
        asar.extractAll(fullpath, extPath);

        setOLTxt('Injecting styles..');
        let stylePath = path.join(__dirname, "styles", platform);
        let indexPath = path.join(extPath, "index.html");
        let rendererPath = path.join(extPath, "renderer.js");
        if (fs.existsSync(rendererPath)) {
            try {
                let updatedRenderer = nodefs
                  .readFileSync(rendererPath)
                  .toString()
                  .replace("DARK_MODE: !prod", "DARK_MODE: true");
                
                nodefs.writeFileSync(rendererPath, updatedRenderer);

                let newAsar = path.join(__dirname, 'app.asar');
                asar.createPackage(extPath, newAsar, function () {
                    setOLTxt('Replacing files..');
                    try {
                        fs.copySync(newAsar, fullpath);

                        setOLTxt('Cleaning up..');
                        fs.removeSync(extPath);
                        fs.removeSync(newAsar);

                        say('All done. May your beautiful eyes burn no more.. Enjoy WhatsApp Dark mode!! :)');

                        let WAPP = spawn(execPath, [], {
                            detached: true,
                            stdio: ['ignore', 'ignore', 'ignore']
                        });
                        WAPP.unref();
                        startInit();
                        started = false;
                    } catch (error) {
                        console.log(error);
                        setOLTxt('An error occurred. Cleaning up..');
                        fs.removeSync(extPath);
                        fs.removeSync(newAsar);
                        startInit();
                        started = false;
                    }
                });
            } catch (error) {
                console.log(error);
                hideOL();
                started = false;
            }
        } else {
            say('\x1b[31m%s\x1b[0m', 'Failed to extract WhatsApp source.');
            hideOL();
            started = false;
        }
    } catch (error) {
        console.log(error);
        hideOL();
        started = false;
    }
}

function restoreBackup(procPath) {
    setOLTxt('Restoring original version of the application...');
    started = true;
    let dir = path.dirname(procPath);
    let fullpath = path.join(dir, 'resources', 'app.asar');

    if (platform === 'darwin') {
        fullpath = procPath;
    }

    try {
        fs.copySync(bkPath, fullpath);

        say('All done. Make sure to let the developers know if something was wrong.. :)');
        let WAPP = spawn(execPath, [], {
            detached: true,
            stdio: ['ignore', 'ignore', 'ignore']
        });
        WAPP.unref();
        hideOL();
        started = false;
    } catch (error) {
        say('An error occurred while restoring.');
        console.log(error);
        hideOL();
        started = false;
    }
}

function openDownload() {
    (async () => {
        await open('https://github.com/m4heshd/whatsapp-desktop-dark/releases/latest');
    })();
}

function openInstaller() {
    (async () => {
        await open('http://127.0.0.1:3210/');
    })();
}

//Client functions
function setOLTxt(text) {
    client.emit('setOLTxt', text);
}

function showOL(text) {
    client.emit('showOL', text);
}

function hideOL() {
    client.emit('hideOL');
}

function setMacUI() {
    client.emit('setMacUI');
}

function setVersion(ver) {
    client.emit('setVersion', ver);
}

function endInit(isBkAvail) {
    client.emit('endInit', isBkAvail);
}

function ask(text, yes, no) {
    client.emit('ask', text, function (resp) {
        if (resp) {
            yes();
        } else {
            no();
        }
    });
}

function say(msg) {
    client.emit('say', msg);
}