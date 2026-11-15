const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('winlaunch', {
  minimize: () => ipcRenderer.invoke('win:minimize'),
  toggleFullscreen: () => ipcRenderer.invoke('win:toggleFullscreen'),
  isFullscreen: () => ipcRenderer.invoke('win:isFullscreen'),
  close: () => ipcRenderer.invoke('win:close'),
  restart: () => ipcRenderer.invoke('system:restart'),
  setAutostart: (on) => ipcRenderer.invoke('system:autostart', on),
  autostartStatus: () => ipcRenderer.invoke('system:autostartStatus'),
  quit: () => ipcRenderer.invoke('app:quit'),
  platform: () => ipcRenderer.invoke('app:platform'),
  // real filesystem
  fsRoots: () => ipcRenderer.invoke('fs:roots'),
  fsList: (dir) => ipcRenderer.invoke('fs:list', dir),
  fsOpen: (p) => ipcRenderer.invoke('fs:open', p),
  fsReveal: (p) => ipcRenderer.invoke('fs:reveal', p),
  fsParent: (p) => ipcRenderer.invoke('fs:parent', p),
  fsJoin: (a, b) => ipcRenderer.invoke('fs:join', a, b),
  // installed apps
  appsList: () => ipcRenderer.invoke('apps:list'),
  appsIcon: (p) => ipcRenderer.invoke('apps:icon', p),
  appsLaunch: (p) => ipcRenderer.invoke('apps:launch', p),
  // kiosk lock
  kioskSet: (on) => ipcRenderer.invoke('kiosk:set', on),
  kioskGet: () => ipcRenderer.invoke('kiosk:get'),
  onKiosk: (cb) => ipcRenderer.on('kiosk:state', (_e, s) => cb(s)),
  // system / media / clipboard
  sysStats: () => ipcRenderer.invoke('sys:stats'),
  screenshot: () => ipcRenderer.invoke('sys:screenshot'),
  clipGet: () => ipcRenderer.invoke('clip:get'),
  clipSet: (t) => ipcRenderer.invoke('clip:set', t),
  clipClear: () => ipcRenderer.invoke('clip:clear'),
  openUrl: (u) => ipcRenderer.invoke('sys:openUrl', u)
});
