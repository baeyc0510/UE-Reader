const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ueReader', {
  onCloseRequested(callback) {
    const listener = () => callback();
    ipcRenderer.on('reader:close-request', listener);
    return () => ipcRenderer.removeListener('reader:close-request', listener);
  },
});
