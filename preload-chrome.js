'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const subscribe = (channel) => (callback) => {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('browser', {
  init: () => ipcRenderer.invoke('app:init'),

  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),

  newTab: (url) => ipcRenderer.send('tabs:new', url),
  closeTab: (id) => ipcRenderer.send('tabs:close', id),
  selectTab: (id) => ipcRenderer.send('tabs:select', id),
  moveTab: (from, to) => ipcRenderer.send('tabs:move', { from, to }),
  tabMenu: (id, x, y) => ipcRenderer.send('tabs:menu', { id, x, y }),

  navigate: (value) => ipcRenderer.send('nav:go', value),
  back: () => ipcRenderer.send('nav:back'),
  forward: () => ipcRenderer.send('nav:forward'),
  reload: (ignoreCache) => ipcRenderer.send('nav:reload', !!ignoreCache),
  stop: () => ipcRenderer.send('nav:stop'),
  home: () => ipcRenderer.send('nav:home'),
  open: (url, newTab) => ipcRenderer.send('nav:open', { url, newTab: !!newTab }),

  toggleBookmark: () => ipcRenderer.send('bookmarks:toggle'),
  removeBookmark: (id) => ipcRenderer.send('bookmarks:remove', id),

  getHistory: (query) => ipcRenderer.invoke('history:list', query),
  suggest: (query) => ipcRenderer.invoke('suggest:query', query),
  removeHistory: (ts) => ipcRenderer.send('history:remove', ts),
  clearHistory: () => ipcRenderer.send('history:clear'),

  getDownloads: () => ipcRenderer.invoke('downloads:list'),
  openDownload: (id) => ipcRenderer.send('downloads:open', id),
  showDownload: (id) => ipcRenderer.send('downloads:show', id),
  clearDownloads: () => ipcRenderer.send('downloads:clear'),

  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  openSettings: () => ipcRenderer.send('settings:open'),

  openOverlay: (type) => ipcRenderer.invoke('overlay:open', type),
  closeOverlay: () => ipcRenderer.invoke('overlay:close'),

  find: (text, forward, findNext) => ipcRenderer.invoke('find:start', { text, forward, findNext }),
  stopFind: () => ipcRenderer.send('find:stop'),

  zoomDelta: (delta) => ipcRenderer.send('zoom:delta', delta),
  zoomReset: () => ipcRenderer.send('zoom:reset'),
  focusPage: () => ipcRenderer.send('tab:focus'),
  freeMemory: () => ipcRenderer.invoke('memory:free'),
  memoryStats: () => ipcRenderer.invoke('memory:stats'),

  setHeight: (px) => ipcRenderer.send('chrome:height', px),

  onState: subscribe('state'),
  onSettings: subscribe('settings:changed'),
  onBookmarks: subscribe('bookmarks:changed'),
  onDownloads: subscribe('downloads:changed'),
  onHistoryChanged: subscribe('history:changed'),
  onFindResult: subscribe('find:result'),
  onFocusOmnibox: subscribe('ui:focus-omnibox'),
  onOpenFind: subscribe('ui:open-find'),
  onOverlayOpen: subscribe('overlay:open'),
  onOverlayClose: subscribe('overlay:close'),
  onToast: subscribe('toast'),
  onImmersive: subscribe('ui:immersive'),
  onOpenOverlay: subscribe('ui:open-overlay'),
  onEscape: subscribe('ui:escape'),
});
