const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('switchTest', {
  onRequest: callback => ipcRenderer.on('browser:panel-request', (_event, request) => callback(request)),
  validate: request => ipcRenderer.invoke('browser-control:validate-switch', request),
  reportTabs: tabs => ipcRenderer.send('browser:tab-state', { ownerSessionId: 'one', tabs }),
  reportActive: id => ipcRenderer.send('browser:active-contents', id, 'one')
});
