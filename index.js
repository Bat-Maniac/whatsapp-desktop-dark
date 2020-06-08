switch (process.platform) {
    case 'win32':
        require("./run-gui").startGUI();
        break;
    case 'darwin':
        require("./run-gui").startGUI();
        break;
    default:
        console.log('\x1b[31m%s\x1b[0m', 'This platform is not supported.\n');
}