'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Only expose the privileged bridge to Аврора Браузер's own start/error pages.
// Web pages loaded in the same tab get nothing.
if (location.protocol === 'aurora:') {
  const subscribe = (channel) => (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };

  contextBridge.exposeInMainWorld('aurora', {
    getSettings: () => ipcRenderer.invoke('start:settings'),
    updateSettings: (patch) => ipcRenderer.invoke('start:update-settings', patch),
    onSettings: subscribe('settings:changed'),
    search: (query) => ipcRenderer.send('start:search', query),
    open: (url, newTab) => ipcRenderer.send('start:open', { url, newTab: !!newTab }),
    setLinks: (links) => ipcRenderer.invoke('start:links', links),
    suggest: (query) => ipcRenderer.invoke('suggest:query', query),
    retry: (url) => ipcRenderer.send('start:retry', url),
    openSettings: () => ipcRenderer.send('settings:open'),
    resetSettings: () => ipcRenderer.invoke('start:reset-settings'),
    clearHistory: () => ipcRenderer.invoke('start:clear-history'),
    clearCache: () => ipcRenderer.invoke('start:clear-cache'),
    clearSiteData: () => ipcRenderer.invoke('start:clear-site-data'),
    memoryStats: () => ipcRenderer.invoke('memory:stats'),
    freeMemory: () => ipcRenderer.invoke('memory:free'),
    isElectron: true,
  });
}
