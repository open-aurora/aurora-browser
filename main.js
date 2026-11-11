'use strict';

const {
  app, BrowserWindow, WebContentsView, ipcMain, protocol,
  shell, session, Menu, clipboard, screen, net,
} = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const START_URL = 'aurora://start/start.html';
const ERROR_URL = 'aurora://start/error.html';
const SETTINGS_URL = 'aurora://settings/settings.html';

app.setName('Аврора Браузер');

// ---------------------------------------------------------------- memory tuning
// Switches must be set before the app is ready. The memory saver is on by
// default; users can turn it off in Аврора Браузере.
let earlySettings = {};
try {
  earlySettings = JSON.parse(
    fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8'),
  );
} catch {}
const MEMORY_SAVER = earlySettings.memorySaver !== false;

app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations');

if (MEMORY_SAVER) {
  // Reuse renderer processes for tabs on the same site without imposing a
  // small global process cap that can queue navigations on multi-tab startup.
  app.commandLine.appendSwitch('process-per-site');

  // Turn off Chromium services Аврора Браузер does not use. Every disabled feature
  // means less background work, fewer caches and a smaller footprint.
  app.commandLine.appendSwitch('disable-features', [
    'Translate',
    'MediaRouter',
    'OptimizationHints',
    'InterestFeedContentSuggestions',
    'CalculateNativeWinOcclusion',
    'AcceptCHFrame',
    'AutofillServerCommunication',
    'PrefetchPrivacyChanges',
    'SegmentationPlatform',
    'SpareRendererForSitePerProcess',
    'CertificateTransparencyComponentUpdater',
    'SignedExchangeSubresourcePrefetch',
    'SubresourceWebBundles',
    'WebOTP',
    'NotificationTriggers',
    'IdleDetection',
    'HeavyAdPrivacyMitigations',
    'PrivacySandboxSettings4',
  ].join(','));

  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-component-update');
  app.commandLine.appendSwitch('disable-sync');
  app.commandLine.appendSwitch('disable-breakpad');
  app.commandLine.appendSwitch('disable-domain-reliability');
  app.commandLine.appendSwitch('no-pings');
  app.commandLine.appendSwitch('metrics-recording-only');
  // Keep reusable HTTP resources on disk; aggressive discarding forced sites
  // to fetch them again and the old 64 MiB cap evicted useful entries quickly.
  app.commandLine.appendSwitch('disk-cache-size', String(256 * 1024 * 1024));
  // Keep V8 heaps from ballooning on heavy pages.
  app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');
}

// ---------------------------------------------------------------- data store

let dataDir = '';
let settings = {};
let bookmarks = [];
let history = [];
let queryLog = [];
let sessionState = { urls: [], activeIndex: 0 };
const downloads = [];

const DEFAULT_SETTINGS = {
  accent: '#4f7cff',
  radius: 16,
  density: 'cozy',
  gradient: 'aurora',
  backgroundId: 'aurora',
  name: '',
  searchEngine: 'google',
  onboardingComplete: false,
  bookmarksBar: true,
  adblock: true,
  animations: true,
  showClock: true,
  restoreSession: true,
  memorySaver: true,
  sleepTabs: true,
  doNotTrack: true,
  blockThirdPartyCookies: true,
  quickLinks: [
    { name: 'YouTube', url: 'https://www.youtube.com' },
    { name: 'GitHub', url: 'https://github.com' },
    { name: 'Gmail', url: 'https://mail.google.com' },
    { name: 'Wikipedia', url: 'https://ru.wikipedia.org' },
    { name: 'Telegram', url: 'https://web.telegram.org' },
    { name: 'Reddit', url: 'https://www.reddit.com' },
    { name: 'Spotify', url: 'https://open.spotify.com' },
    { name: 'Notion', url: 'https://www.notion.so' },
  ],
};

const ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  ddg: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  yandex: { name: 'Яндекс', url: 'https://yandex.ru/search/?text=%s' },
  brave: { name: 'Brave', url: 'https://search.brave.com/search?q=%s' },
};

const AD_HOSTS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'google-analytics.com', 'googletagmanager.com', 'adservice.google.com',
  'amazon-adsystem.com', 'adnxs.com', 'criteo.com', 'criteo.net',
  'taboola.com', 'outbrain.com', 'scorecardresearch.com', 'quantserve.com',
  'hotjar.com', 'adform.net', 'pubmatic.com', 'rubiconproject.com',
  'openx.net', 'casalemedia.com', 'smartadserver.com', 'serving-sys.com',
  'moatads.com', 'mc.yandex.ru', 'an.yandex.ru', 'ad.mail.ru',
  'top-fwz1.mail.ru', 'ads.yahoo.com', 'advertising.com',
  'media.net', 'zedo.com', 'revcontent.com', 'mgid.com',
];
const AD_HOST_SET = new Set(AD_HOSTS);

function dataPath(name) { return path.join(dataDir, name); }

function readJSON(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(dataPath(name), 'utf8'));
  } catch {
    return fallback;
  }
}

let saveTimers = new Map();
function writeJSON(name, value) {
  clearTimeout(saveTimers.get(name));
  saveTimers.set(name, setTimeout(() => {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(dataPath(name), JSON.stringify(value));
    } catch (err) {
      console.error('write failed', name, err);
    }
  }, 120));
}

function writeJSONSync(name, value) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(dataPath(name), JSON.stringify(value));
  } catch {}
}

function loadData() {
  const savedSettings = readJSON('settings.json', {});
  settings = Object.assign({}, DEFAULT_SETTINGS, savedSettings);
  // Existing users get this setup once, with their current choices pre-filled.
  bookmarks = readJSON('bookmarks.json', []);
  history = readJSON('history.json', []);
  queryLog = readJSON('queries.json', []);
  sessionState = readJSON('session.json', { urls: [], activeIndex: 0 });
}

// ---------------------------------------------------------------- utilities

let blockedCount = 0;
let blockedTimer = null;

function engineUrl(query) {
  const eng = ENGINES[settings.searchEngine] || ENGINES.google;
  return eng.url.replace('%s', encodeURIComponent(query));
}

function looksLikeUrl(value) {
  const s = value.trim();
  if (!s || /\s/.test(s)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return true;
  if (/^(about|mailto|tel|aurora):/i.test(s)) return true;
  if (/^localhost(:\d+)?(\/|$)/i.test(s)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(s)) return true;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s) && !/^[\d.]+$/.test(s)) return true;
  return false;
}

function resolveInput(value) {
  const s = value.trim();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(about|mailto|tel|aurora):/i.test(s)) return s;
  if (/^localhost(:\d+)?(\/|$)/i.test(s) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(s)) return 'http://' + s;
  if (looksLikeUrl(s)) return 'https://' + s;
  return engineUrl(s);
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

function prettyTitle(tab) {
  if (tab.title) return tab.title;
  if (tab.url.startsWith('aurora://')) return 'Новая вкладка';
  return hostOf(tab.url) || tab.url;
}

function suggestionMatches(item, query) {
  const title = String(item.title || '');
  const url = String(item.url || '');
  const host = hostOf(url);
  return title.toLowerCase().includes(query) ||
    url.toLowerCase().includes(query) ||
    host.toLowerCase().includes(query);
}

function suggestionList(query, limit = 6) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const seen = new Set();
  const items = [];
  const push = (type, item) => {
    if (!item || !item.url) return;
    if (/^(aurora|file|chrome|devtools):/i.test(item.url)) return;
    if (seen.has(item.url)) return;
    seen.add(item.url);
    items.push({
      type,
      title: item.title || item.name || hostOf(item.url) || item.url,
      url: item.url,
      host: hostOf(item.url),
      favicon: item.favicon || '',
    });
  };

  for (const bookmark of bookmarks) {
    if (suggestionMatches(bookmark, q)) push('bookmark', bookmark);
  }
  for (const link of settings.quickLinks || []) {
    if (suggestionMatches(link, q)) push('quicklink', link);
  }
  for (const entry of history) {
    if (suggestionMatches(entry, q)) push('history', entry);
  }
  return items.slice(0, limit);
}

/* ---------------------------------------------------------------- completions */

const SUGGEST_CACHE = new Map();
const SUGGEST_TTL = 10 * 60 * 1000;

function completionText(value, prefix, out, seen) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return;
  const low = text.toLowerCase();
  if (low === prefix || !low.startsWith(prefix)) return;
  if (seen.has(low)) return;
  seen.add(low);
  out.push(text);
}

function localCompletions(query, limit = 3) {
  const prefix = String(query || '').trim().toLowerCase();
  if (prefix.length < 2) return [];
  const out = [];
  const seen = new Set();
  for (const item of queryLog) completionText(item, prefix, out, seen);
  for (const source of [...bookmarks, ...(settings.quickLinks || []), ...history]) {
    const title = source.title || source.name || '';
    completionText(title, prefix, out, seen);
    for (const word of String(title).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []) {
      completionText(word, prefix, out, seen);
    }
  }
  return out.slice(0, limit);
}

function suggestEndpoint(engine, query) {
  const q = encodeURIComponent(query);
  switch (engine) {
    case 'ddg':
      return `https://duckduckgo.com/ac/?q=${q}&type=list`;
    case 'bing':
      return `https://api.bing.com/osjson.aspx?query=${q}&market=ru-RU`;
    case 'yandex':
      return `https://suggest.yandex.ru/suggest-ff.cgi?part=${q}&uil=ru&v=4&sn=5`;
    case 'brave':
      return '';
    default:
      return `https://suggestqueries.google.com/complete/search?client=firefox&hl=ru&q=${q}`;
  }
}

async function engineCompletions(query) {
  const engine = settings.searchEngine || 'google';
  const value = String(query || '').trim();
  if (value.length < 2) return [];
  const key = `${engine}\n${value.toLowerCase()}`;
  const cached = SUGGEST_CACHE.get(key);
  if (cached && Date.now() - cached.ts < SUGGEST_TTL) return cached.items;

  const endpoint = suggestEndpoint(engine, value);
  if (!endpoint) return [];

  try {
    const response = await net.fetch(endpoint, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(800),
    });
    if (!response.ok) return [];
    const data = JSON.parse(await response.text());
    let raw = [];
    if (engine === 'ddg') {
      raw = Array.isArray(data) ? data.map((item) => (item && typeof item === 'object' ? item.phrase : item)) : [];
    } else {
      raw = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
    }
    const prefix = value.toLowerCase();
    const items = [];
    const seen = new Set();
    for (const item of raw) {
      if (typeof item !== 'string') continue;
      const text = item.trim();
      const low = text.toLowerCase();
      if (!text || low === prefix || !low.startsWith(prefix) || seen.has(low)) continue;
      seen.add(low);
      items.push(text);
      if (items.length >= 5) break;
    }
    SUGGEST_CACHE.set(key, { ts: Date.now(), items });
    if (SUGGEST_CACHE.size > 240) {
      SUGGEST_CACHE.delete(SUGGEST_CACHE.keys().next().value);
    }
    return items;
  } catch {
    return [];
  }
}

async function smartSuggestions(query) {
  const value = String(query || '').trim();
  if (!value) return { completions: [], pages: [] };
  const [local, remote] = await Promise.all([
    Promise.resolve(localCompletions(value)),
    engineCompletions(value),
  ]);
  const completions = [];
  const seen = new Set();
  for (const item of [...local, ...remote]) {
    const low = item.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    completions.push(item);
    if (completions.length >= 5) break;
  }
  return { completions, pages: suggestionList(value) };
}

// ---------------------------------------------------------------- state / io

let win = null;
let chromeReady = false;
const tabs = new Map();
let order = [];
let activeId = null;
let tabSeq = 0;
let chromeHeight = 96;
let overlayType = null;
let immersive = false;
let contentRadius = 20;
let isMaximized = false;
let closedStack = [];

function chromeSend(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function activeTab() {
  return activeId ? tabs.get(activeId) : null;
}

function tabSummary(tab) {
  let canGoBack = false;
  let canGoForward = false;
  try {
    canGoBack = tab.wc.navigationHistory.canGoBack();
    canGoForward = tab.wc.navigationHistory.canGoForward();
  } catch {}
  return {
    id: tab.id,
    url: tab.url,
    title: prettyTitle(tab),
    favicon: tab.favicon || '',
    loading: tab.loading,
    canGoBack,
    canGoForward,
    secure: tab.url.startsWith('https://'),
    isStart: tab.url.startsWith('aurora://start'),
    isError: !!tab.isError,
    asleep: !!tab.asleep,
  };
}

function statePayload() {
  return {
    tabs: order.map((id) => tabSummary(tabs.get(id))).filter(Boolean),
    activeId,
    maximized: isMaximized,
    blocked: blockedCount,
    overlay: overlayType,
    zoom: activeTab() ? Math.round(Math.pow(1.2, activeTab().zoomLevel || 0) * 100) : 100,
  };
}

let broadcastTimer = null;
function broadcast(delay = 30) {
  clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => chromeSend('state', statePayload()), delay);
}

function broadcastSettings() {
  chromeSend('settings:changed', settings);
  for (const tab of tabs.values()) {
    try { tab.wc.send('settings:changed', settings); } catch {}
  }
}

function broadcastBookmarks() {
  chromeSend('bookmarks:changed', bookmarks);
}

function broadcastDownloads() {
  chromeSend('downloads:changed', downloads);
}

// ---------------------------------------------------------------- layout

function layout() {
  if (!win || win.isDestroyed()) return;
  const [w, h] = win.getContentSize();
  for (const tab of tabs.values()) {
    try { tab.view.setVisible(false); } catch {}
  }
  const tab = activeTab();
  if (!tab) return;
  if (tab.asleep) wakeTab(tab);

  if (immersive) {
    try {
      tab.view.setBorderRadius(0);
      tab.view.setBounds({ x: 0, y: 0, width: w, height: h });
      tab.view.setVisible(true);
    } catch {}
    return;
  }

  if (overlayType) return;

  const margin = 10;
  const top = Math.max(0, chromeHeight);
  const bounds = {
    x: margin,
    y: top + margin,
    width: Math.max(0, w - margin * 2),
    height: Math.max(0, h - top - margin * 2),
  };
  try {
    tab.view.setBorderRadius(contentRadius);
    tab.view.setBounds(bounds);
    tab.view.setVisible(true);
  } catch {}
}

// ---------------------------------------------------------------- history

let lastHistoryKey = '';

function addHistory(url, title) {
  if (!/^https?:\/\//i.test(url)) return null;
  const now = Date.now();
  const prev = history[0];
  if (prev && prev.url === url && now - prev.ts < 2500) {
    if (title) prev.title = title;
    writeJSON('history.json', history);
    return prev;
  }
  const entry = { url, title: title || hostOf(url), ts: now };
  history.unshift(entry);
  if (history.length > 3000) history.length = 3000;
  writeJSON('history.json', history);
  chromeSend('history:changed');
  return entry;
}

function updateHistoryTitle(url, title) {
  if (!title) return;
  const entry = history.find((e, i) => i < 30 && e.url === url);
  if (entry) {
    entry.title = title;
    writeJSON('history.json', history);
    chromeSend('history:changed');
  }
}

function addQuery(query) {
  const value = String(query || '').trim();
  if (!value || value.length > 140 || looksLikeUrl(value)) return;
  queryLog = queryLog.filter((item) => String(item).toLowerCase() !== value.toLowerCase());
  queryLog.unshift(value);
  if (queryLog.length > 400) queryLog.length = 400;
  writeJSON('queries.json', queryLog);
}

// ---------------------------------------------------------------- tabs

function mountTab(tab, target) {
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(ROOT, 'preload-start.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: true,
    },
  });
  view.setBackgroundColor('#ffffff');

  const wc = view.webContents;
  tab.view = view;
  tab.wc = wc;
  tab.asleep = false;

  win.contentView.addChildView(view);

  wc.setWindowOpenHandler(({ url: openUrl }) => {
    if (/^https?:|^aurora:/i.test(openUrl)) {
      createTab(openUrl, { activate: true });
    } else if (/^(mailto|tel):/i.test(openUrl)) {
      shell.openExternal(openUrl);
    }
    return { action: 'deny' };
  });

  wc.on('page-title-updated', (_e, title) => {
    tab.title = title;
    updateHistoryTitle(tab.url, title);
    broadcast();
  });

  wc.on('page-favicon-updated', (_e, icons) => {
    if (icons && icons.length) {
      tab.favicon = icons[icons.length - 1];
      broadcast();
    }
  });

  wc.on('did-start-loading', () => {
    tab.loading = true;
    broadcast();
  });

  wc.on('did-stop-loading', () => {
    tab.loading = false;
    broadcast();
  });

  wc.on('did-start-navigation', (event) => {
    if (!event.isMainFrame) return;
    if (event.url.startsWith('aurora://start/error.html')) return;
    tab.isError = false;
  });

  wc.on('did-navigate', (_e, navUrl) => {
    if (navUrl.startsWith('aurora://start/error.html')) { broadcast(); return; }
    const staleTitle = tab.url !== navUrl;
    tab.url = navUrl;
    tab.isError = false;
    if (/^https?:\/\//i.test(navUrl)) {
      tab.historyEntry = addHistory(navUrl, staleTitle ? '' : tab.title);
    }
    broadcast();
  });

  wc.on('did-navigate-in-page', (_e, navUrl) => {
    if (!navUrl.startsWith('aurora://start/error.html')) tab.url = navUrl;
    broadcast();
  });

  wc.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3 || code === 0) return;
    if (failedUrl.startsWith('aurora://') || failedUrl.startsWith('chrome-error:')) return;
    tab.isError = true;
    tab.url = failedUrl || tab.url;
    tab.title = prettyTitle(tab);
    const errorPage = `${ERROR_URL}?u=${encodeURIComponent(tab.url)}&code=${code}&desc=${encodeURIComponent(desc || '')}`;
    wc.loadURL(errorPage).catch(() => {});
    broadcast();
  });

  wc.on('render-process-gone', () => {
    tab.loading = false;
    broadcast();
  });

  wc.on('enter-html-full-screen', () => {
    immersive = true;
    chromeSend('ui:immersive', true);
    layout();
  });
  wc.on('leave-html-full-screen', () => {
    immersive = false;
    chromeSend('ui:immersive', false);
    layout();
  });

  wc.on('found-in-page', (_e, result) => {
    chromeSend('find:result', {
      matches: result.matches,
      active: result.activeMatchOrdinal,
      finalUpdate: result.finalUpdate,
    });
  });

  wc.on('context-menu', (_e, params) => showPageContextMenu(tab, params));
  attachShortcuts(wc);
  wireHistoryNavigation(wc, tab);

  wc.loadURL(target).catch(() => {});
}

function createTab(url, options = {}) {
  if (!win) return null;
  const target = url || START_URL;
  const id = 'tab-' + (++tabSeq);
  const tab = {
    id, view: null, wc: null,
    url: target,
    title: '',
    favicon: '',
    loading: false,
    isError: false,
    zoomLevel: 0,
    historyEntry: null,
    asleep: false,
    lastActive: Date.now(),
  };
  tabs.set(id, tab);
  if (typeof options.index === 'number') order.splice(options.index, 0, id);
  else order.push(id);

  if (options.lazy) {
    // Restored tabs are not loaded until the user opens them: this keeps the
    // startup footprint close to a single tab instead of a dozen.
    tab.asleep = true;
    tab.title = prettyTitle(tab);
  } else {
    mountTab(tab, target);
  }

  if (options.activate !== false) {
    activeId = id;
    tab.lastActive = Date.now();
    if (tab.asleep) wakeTab(tab);
    if (overlayType) overlayClose(true);
  }
  layout();
  broadcast(0);
  saveSession();
  return tab;
}

// ---------------------------------------------------------------- tab sleep

function wakeTab(tab) {
  if (!tab || !tab.asleep) return;
  tab.asleep = false;
  mountTab(tab, tab.url || START_URL);
}

function sleepTab(tab, notify = true) {
  if (!tab || tab.asleep || tab.id === activeId) return false;
  try {
    if (tab.wc && tab.wc.isCurrentlyAudible()) return false;
  } catch {}

  const view = tab.view;
  const wc = tab.wc;
  tab.asleep = true;
  tab.loading = false;
  tab.view = null;
  tab.wc = null;
  tab.title = tab.title || prettyTitle(tab);

  try {
    if (view) win.contentView.removeChildView(view);
    if (wc) wc.close();
  } catch {}

  if (notify) broadcast(0);
  return true;
}

function sleepInactiveTabs() {
  if (!settings.sleepTabs) return;
  const now = Date.now();
  const idleMs = 5 * 60 * 1000;
  for (const tab of tabs.values()) {
    if (tab.id === activeId || tab.asleep || tab.loading) continue;
    if (now - (tab.lastActive || 0) < idleMs) continue;
    sleepTab(tab, false);
  }
  broadcast(0);
}

function freeMemory() {
  const now = Date.now();
  let freed = 0;
  for (const tab of tabs.values()) {
    if (tab.id === activeId || tab.asleep || tab.loading) continue;
    // Keep tabs the user has just visited; release everything older.
    if (now - (tab.lastActive || 0) < 20000) continue;
    if (sleepTab(tab, false)) freed++;
  }
  try { session.defaultSession.clearCache().catch(() => {}); } catch {}
  broadcast(0);
  return freed;
}

function wireHistoryNavigation(wc, tab) {
  // keep tab summary fresh after in-page navigations
  wc.on('did-frame-finish-load', () => broadcast());
}

function closeTab(id, opts = {}) {
  const tab = tabs.get(id);
  if (!tab) return;
  if (!opts.silent && !tab.url.startsWith('aurora://start')) {
    closedStack.unshift({ url: tab.url, title: prettyTitle(tab) });
    if (closedStack.length > 25) closedStack.length = 25;
  }
  const idx = order.indexOf(id);
  tabs.delete(id);
  order = order.filter((x) => x !== id);
  try {
    if (tab.view) win.contentView.removeChildView(tab.view);
    if (tab.wc) tab.wc.close();
  } catch {}

  if (activeId === id) {
    const next = order[Math.min(idx, order.length - 1)];
    activeId = next || null;
    if (activeId) {
      const nextTab = tabs.get(activeId);
      if (nextTab && nextTab.asleep) wakeTab(nextTab);
    }
  }
  if (!order.length) {
    createTab(START_URL);
    return;
  }
  layout();
  broadcast(0);
  saveSession();
}

function selectTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  if (activeTab() && activeTab().id !== id) {
    try { activeTab().wc.stopFindInPage('clearSelection'); } catch {}
  }
  activeId = id;
  tab.lastActive = Date.now();
  if (tab.asleep) wakeTab(tab);
  layout();
  broadcast(0);
  saveSession();
  try { tab.wc.focus(); } catch {}
}

function reopenClosedTab() {
  const item = closedStack.shift();
  if (!item) return;
  createTab(item.url);
}

function activateByOffset(delta) {
  if (!order.length) return;
  const idx = order.indexOf(activeId);
  const next = (idx + delta + order.length) % order.length;
  selectTab(order[next]);
}

function saveSession() {
  const urls = order
    .map((id) => tabs.get(id))
    .filter((t) => t && /^https?:\/\//i.test(t.url))
    .map((t) => t.url);
  const activeIdx = Math.max(0, order.indexOf(activeId));
  sessionState = { urls, activeIndex: activeIdx, ts: Date.now() };
  writeJSON('session.json', sessionState);
}

// ---------------------------------------------------------------- shortcuts

function attachShortcuts(wc) {
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const mod = process.platform === 'darwin' ? input.meta : input.control;
    const key = (input.key || '').toLowerCase();

    if (input.alt && (key === 'left' || key === 'arrowleft')) {
      event.preventDefault();
      goBack();
      return;
    }
    if (input.alt && (key === 'right' || key === 'arrowright')) {
      event.preventDefault();
      goForward();
      return;
    }

    if (mod && !input.alt) {
      switch (key) {
        case 't':
          event.preventDefault();
          if (input.shift) reopenClosedTab();
          else openNewTab();
          break;
        case 'w':
          event.preventDefault();
          if (activeId) closeTab(activeId);
          break;
        case 'l':
        case 'k':
          event.preventDefault();
          focusChrome();
          chromeSend('ui:focus-omnibox');
          break;
        case 'd':
          event.preventDefault();
          toggleBookmark();
          break;
        case 'r':
          event.preventDefault();
          reload(input.shift);
          break;
        case 'f':
          event.preventDefault();
          focusChrome();
          chromeSend('ui:open-find');
          break;
        case 'h':
          event.preventDefault();
          focusChrome();
          chromeSend('ui:open-overlay', 'history');
          break;
        case 'j':
          event.preventDefault();
          focusChrome();
          chromeSend('ui:open-overlay', 'downloads');
          break;
        case 'b':
          if (input.shift) {
            event.preventDefault();
            updateSettings({ bookmarksBar: !settings.bookmarksBar });
          }
          break;
        case '=':
        case '+':
          event.preventDefault();
          zoomDelta(0.5);
          break;
        case '-':
        case '_':
          event.preventDefault();
          zoomDelta(-0.5);
          break;
        case '0':
          event.preventDefault();
          setZoom(0);
          break;
        case 'tab':
          event.preventDefault();
          activateByOffset(input.shift ? -1 : 1);
          break;
        case 'i':
          if (input.shift) {
            event.preventDefault();
            const t = activeTab();
            if (t) t.wc.openDevTools({ mode: 'detach', activate: true });
          }
          break;
        case ',':
          event.preventDefault();
          openSettings();
          break;
        default:
          if (/^[1-9]$/.test(key)) {
            event.preventDefault();
            const idx = Number(key) - 1;
            if (order[idx]) selectTab(order[idx]);
          }
      }
    }

    if (!mod && key === 'escape' && wc !== win.webContents) {
      chromeSend('ui:escape');
    }
    if (!mod && key === 'f5') {
      event.preventDefault();
      reload(input.shift);
    }
    if (!mod && key === 'f12') {
      event.preventDefault();
      const t = activeTab();
      if (t) t.wc.toggleDevTools();
    }
  });
}

// ---------------------------------------------------------------- navigation

function focusChrome() {
  if (win && !win.isDestroyed()) {
    try { win.webContents.focus(); } catch {}
  }
}

function openNewTab(url) {
  createTab(url || START_URL);
  focusChrome();
  chromeSend('ui:focus-omnibox');
}

function openSettings() {
  for (const tab of tabs.values()) {
    if (tab.url.startsWith('aurora://settings')) {
      selectTab(tab.id);
      return tab;
    }
  }
  return createTab(SETTINGS_URL);
}

function goBack() {
  const t = activeTab();
  if (t) t.wc.navigationHistory.goBack();
}

function goForward() {
  const t = activeTab();
  if (t) t.wc.navigationHistory.goForward();
}

function reload(ignoreCache = false) {
  const t = activeTab();
  if (!t) return;
  if (t.isError) {
    t.isError = false;
    t.wc.loadURL(t.url).catch(() => {});
    return;
  }
  if (ignoreCache) t.wc.reloadIgnoringCache();
  else t.wc.reload();
}

function navigate(value, tab = activeTab()) {
  if (!tab) return;
  if (!looksLikeUrl(String(value || ''))) addQuery(value);
  const url = resolveInput(value);
  if (!url) return;
  overlayClose(false);
  tab.wc.loadURL(url).catch(() => {});
  try { tab.wc.focus(); } catch {}
}

function setZoom(level) {
  const t = activeTab();
  if (!t) return;
  t.zoomLevel = Math.max(-5, Math.min(5, level));
  t.wc.setZoomLevel(t.zoomLevel);
  broadcast(0);
}

function zoomDelta(delta) {
  const t = activeTab();
  if (!t) return;
  setZoom((t.zoomLevel || 0) + delta);
}

// ---------------------------------------------------------------- bookmarks

function toggleBookmark() {
  const t = activeTab();
  if (!t || !/^https?:\/\//i.test(t.url)) return;
  const existing = bookmarks.findIndex((b) => b.url === t.url);
  if (existing >= 0) {
    bookmarks.splice(existing, 1);
    chromeSend('toast', { text: 'Удалено из закладок', icon: 'star-off' });
  } else {
    bookmarks.unshift({
      id: 'bm-' + Date.now(),
      title: prettyTitle(t),
      url: t.url,
      favicon: t.favicon || '',
      ts: Date.now(),
    });
    chromeSend('toast', { text: 'Добавлено в закладки', icon: 'star' });
  }
  writeJSON('bookmarks.json', bookmarks);
  broadcastBookmarks();
  broadcast(0);
}

// ---------------------------------------------------------------- settings

function updateSettings(patch) {
  if (patch.startPageLayout && typeof patch.startPageLayout === 'object') {
    const source = patch.startPageLayout;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
    const items = {};
    if (source.items && typeof source.items === 'object') {
      for (const [id, item] of Object.entries(source.items).slice(0, 16)) {
        if (!/^(clock|hero|links|foot|widget-(weather|battery|speed))$/.test(id) || !item || typeof item !== 'object') continue;
        items[id] = {
          x: clamp(item.x, 0, 95), y: clamp(item.y, 0, 95),
          w: clamp(item.w, 5, 100), h: clamp(item.h, 5, 100),
        };
        items[id].w = Math.min(items[id].w, 100 - items[id].x);
        items[id].h = Math.min(items[id].h, 100 - items[id].y);
      }
    }
    const widgets = Array.isArray(source.widgets)
      ? [...new Set(source.widgets.filter((id) => ['weather', 'battery', 'speed'].includes(id)))].slice(0, 3)
      : [];
    patch = { ...patch, startPageLayout: { items, widgets, city: String(source.city || '').slice(0, 80) } };
  }
  settings = Object.assign({}, settings, patch);
  if (patch.radius !== undefined) {
    contentRadius = Math.max(0, Math.min(28, Number(settings.radius) + 6));
  }
  writeJSON('settings.json', settings);
  broadcastSettings();
  broadcast(0);
  layout();
  return settings;
}

// ---------------------------------------------------------------- context menu

function showPageContextMenu(tab, params) {
  const items = [];
  const wc = tab.wc;

  if (params.linkURL) {
    items.push(
      { label: 'Открыть в новой вкладке', click: () => createTab(params.linkURL) },
      { label: 'Открыть в фоновой вкладке', click: () => createTab(params.linkURL, { activate: false }) },
      { label: 'Копировать ссылку', click: () => clipboard.writeText(params.linkURL) },
      { type: 'separator' },
    );
  }
  if (params.srcURL) {
    items.push(
      { label: 'Открыть изображение в новой вкладке', click: () => createTab(params.srcURL) },
      { label: 'Копировать изображение', click: () => wc.copyImageAt(params.x, params.y) },
      { label: 'Сохранить изображение', click: () => wc.downloadURL(params.srcURL) },
      { type: 'separator' },
    );
  }
  if (params.isEditable) {
    items.push(
      { role: 'undo', label: 'Отменить' },
      { role: 'redo', label: 'Повторить' },
      { type: 'separator' },
      { role: 'cut', label: 'Вырезать' },
      { role: 'copy', label: 'Копировать' },
      { role: 'paste', label: 'Вставить' },
      { role: 'selectAll', label: 'Выделить всё' },
    );
  } else if (params.selectionText) {
    items.push(
      { role: 'copy', label: 'Копировать' },
      {
        label: `Найти в ${ENGINES[settings.searchEngine]?.name || 'Google'}`,
        click: () => navigate(params.selectionText),
      },
      { type: 'separator' },
    );
  }
  if (!params.isEditable && !params.linkURL) {
    items.push(
      { label: 'Назад', enabled: wc.navigationHistory.canGoBack(), click: goBack },
      { label: 'Вперёд', enabled: wc.navigationHistory.canGoForward(), click: goForward },
      { label: 'Обновить', click: () => wc.reload() },
      { type: 'separator' },
      { label: 'Сохранить страницу…', click: () => wc.downloadURL(wc.getURL()) },
      { label: 'Печать…', click: () => wc.print() },
      { type: 'separator' },
      {
        label: 'Исходный код страницы',
        click: () => createTab('view-source:' + wc.getURL()),
      },
      {
        label: 'Инструменты разработчика',
        click: () => wc.openDevTools({ mode: 'detach' }),
      },
    );
  }

  if (!items.length) return;
  Menu.buildFromTemplate(items).popup({ window: win });
}

function showTabContextMenu(id, x, y) {
  const tab = tabs.get(id);
  if (!tab) return;
  Menu.buildFromTemplate([
    { label: 'Дублировать вкладку', click: () => createTab(tab.url, { index: order.indexOf(id) + 1 }) },
    { label: 'Обновить', enabled: !tab.asleep, click: () => tab.wc && tab.wc.reload() },
    { label: 'Копировать адрес', click: () => clipboard.writeText(tab.url) },
    {
      label: 'Отправить в сон',
      enabled: !tab.asleep && id !== activeId,
      click: () => sleepTab(tab),
    },
    { type: 'separator' },
    { label: 'Закрыть вкладку', click: () => closeTab(id) },
    {
      label: 'Закрыть другие вкладки',
      enabled: order.length > 1,
      click: () => { for (const other of [...order]) if (other !== id) closeTab(other); },
    },
  ]).popup({ window: win, x: Math.round(x), y: Math.round(y) });
}

// ---------------------------------------------------------------- downloads

let downloadSeq = 0;

function uniquePath(dir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(dir, filename);
  let i = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base} (${i++})${ext}`);
  }
  return candidate;
}

function setupDownloads() {
  session.defaultSession.on('will-download', (event, item) => {
    const rec = {
      id: 'dl-' + (++downloadSeq),
      filename: item.getFilename(),
      url: item.getURL(),
      state: 'progressing',
      received: 0,
      total: item.getTotalBytes(),
      savePath: '',
      paused: false,
      started: Date.now(),
    };
    const dir = app.getPath('downloads');
    const savePath = uniquePath(dir, rec.filename);
    rec.savePath = savePath;
    item.setSavePath(savePath);
    downloads.unshift(rec);
    broadcastDownloads();
    chromeSend('toast', { text: 'Загрузка началась: ' + rec.filename, icon: 'download' });

    item.on('updated', (_e, state) => {
      rec.received = item.getReceivedBytes();
      rec.total = item.getTotalBytes();
      rec.paused = item.isPaused();
      rec.state = state === 'interrupted' ? 'interrupted' : 'progressing';
      broadcastDownloads();
    });
    item.once('done', (_e, state) => {
      rec.state = state;
      rec.received = item.getReceivedBytes();
      rec.total = item.getTotalBytes() || rec.received;
      rec.savePath = item.getSavePath() || savePath;
      broadcastDownloads();
      if (state === 'completed') {
        chromeSend('toast', { text: 'Загружено: ' + rec.filename, icon: 'check' });
      }
    });
  });
}

// ---------------------------------------------------------------- overlay

async function overlayOpen(type) {
  focusChrome();
  if (!overlayType) {
    let backdrop = '';
    const t = activeTab();
    if (t && !immersive) {
      try {
        const image = await t.view.webContents.capturePage();
        if (!image.isEmpty()) backdrop = image.toDataURL();
      } catch {}
    }
    overlayType = type;
    chromeSend('overlay:open', { type, backdrop });
    layout();
  } else {
    overlayType = type;
    chromeSend('overlay:open', { type, backdrop: '' });
    layout();
  }
}

function overlayClose(notify = true) {
  if (!overlayType) {
    if (notify) chromeSend('overlay:close');
    return;
  }
  overlayType = null;
  if (notify) chromeSend('overlay:close');
  layout();
}

// ---------------------------------------------------------------- adblock / session

function setupSession() {
  const ses = session.defaultSession;
  ses.setUserAgent(
    app.userAgentFallback
      .replace(/\sElectron\/[\d.]+/i, '')
      .replace(/\sАврора Браузер\/[\d.]+/i, ''),
  );

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ['fullscreen', 'notifications', 'pointerLock', 'clipboard-sanitized-write'];
    callback(allowed.includes(permission));
  });

  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    if (!settings.adblock) return callback({});
    try {
      let host = new URL(details.url).hostname;
      let blocked = false;
      while (host) {
        if (AD_HOST_SET.has(host)) {
          blocked = true;
          break;
        }
        const dot = host.indexOf('.');
        if (dot < 0) break;
        host = host.slice(dot + 1);
      }
      if (blocked) {
        blockedCount++;
        clearTimeout(blockedTimer);
        blockedTimer = setTimeout(() => broadcast(0), 600);
        return callback({ cancel: true });
      }
    } catch {}
    callback({});
  });

  // Express the user's privacy preference without exposing browser identity.
  // Also avoid sending cookies to an embedded third-party origin when enabled.
  ses.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    const headers = { ...details.requestHeaders };
    if (settings.doNotTrack !== false) headers.DNT = '1';

    if (settings.blockThirdPartyCookies !== false && headers.Cookie) {
      try {
        const requestHost = new URL(details.url).hostname;
        const initiator = details.initiator || '';
        const initiatorHost = initiator ? new URL(initiator).hostname : requestHost;
        const sameSite = initiatorHost === requestHost ||
          initiatorHost.endsWith(`.${requestHost}`) || requestHost.endsWith(`.${initiatorHost}`);
        if (!sameSite) delete headers.Cookie;
      } catch {}
    }
    callback({ requestHeaders: headers });
  });

  ses.webRequest.onHeadersReceived({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    if (settings.blockThirdPartyCookies !== false) {
      try {
        const requestHost = new URL(details.url).hostname;
        const initiator = details.initiator || '';
        const initiatorHost = initiator ? new URL(initiator).hostname : requestHost;
        const sameSite = initiatorHost === requestHost ||
          initiatorHost.endsWith(`.${requestHost}`) || requestHost.endsWith(`.${initiatorHost}`);
        if (!sameSite) {
          for (const key of Object.keys(responseHeaders)) {
            if (key.toLowerCase() === 'set-cookie') delete responseHeaders[key];
          }
        }
      } catch {}
    }
    callback({ responseHeaders });
  });
}

// ---------------------------------------------------------------- window

function createWindow() {
  let width = 1380;
  let height = 880;
  try {
    const area = screen.getPrimaryDisplay().workAreaSize;
    width = Math.min(width, Math.max(900, area.width - 48));
    height = Math.min(height, Math.max(600, area.height - 48));
  } catch {}

  win = new BrowserWindow({
    width,
    height,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: '#eef0f4',
    title: 'Аврора Браузер',
    icon: path.join(ROOT, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(ROOT, 'preload-chrome.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  // Start the active page while Chromium paints the browser chrome instead
  // of waiting for the toolbar to finish loading before beginning navigation.
  const urls = settings.restoreSession ? (sessionState.urls || []) : [];
  if (urls.length) {
    const list = urls.slice(0, 12);
    const activeIdx = Math.min(sessionState.activeIndex || 0, list.length - 1);
    list.forEach((u, i) => createTab(u, { activate: false, lazy: i !== activeIdx }));
    const idx = Math.min(activeIdx, order.length - 1);
    if (order[idx]) selectTab(order[idx]);
    else if (order[0]) selectTab(order[0]);
  } else {
    createTab(START_URL);
  }

  win.loadFile(path.join(ROOT, 'html', 'chrome.html'));

  win.once('ready-to-show', () => {
    win.show();
    chromeReady = true;
    broadcast(0);
  });

  win.on('resize', () => layout());
  win.on('maximize', () => { isMaximized = true; broadcast(0); });
  win.on('unmaximize', () => { isMaximized = false; broadcast(0); });
  win.on('enter-full-screen', () => { isMaximized = true; broadcast(0); });
  win.on('leave-full-screen', () => { isMaximized = win.isMaximized(); broadcast(0); });

  win.on('close', () => {
    saveSession();
    writeJSONSync('session.json', sessionState);
    writeJSONSync('settings.json', settings);
    writeJSONSync('bookmarks.json', bookmarks);
    writeJSONSync('history.json', history);
  });

  win.on('closed', () => {
    win = null;
  });

  attachShortcuts(win.webContents);
}

// ---------------------------------------------------------------- IPC

function setupIPC() {
  ipcMain.handle('app:init', () => ({
    settings,
    bookmarks,
    downloads,
    appVersion: app.getVersion(),
    engines: Object.fromEntries(Object.entries(ENGINES).map(([k, v]) => [k, v.name])),
    state: statePayload(),
  }));

  ipcMain.on('window:minimize', () => win && win.minimize());
  ipcMain.on('window:maximize', () => {
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('window:close', () => win && win.close());

  ipcMain.on('chrome:height', (_e, px) => {
    const h = Math.max(0, Math.round(px));
    if (Math.abs(h - chromeHeight) > 0.5) {
      chromeHeight = h;
      layout();
    }
  });

  ipcMain.on('tabs:new', (_e, url) => openNewTab(url));
  ipcMain.on('settings:open', () => openSettings());
  ipcMain.on('tabs:close', (_e, id) => closeTab(id));
  ipcMain.on('tabs:select', (_e, id) => selectTab(id));
  ipcMain.on('tabs:move', (_e, { from, to }) => {
    if (from < 0 || from >= order.length || to < 0 || to >= order.length) return;
    const [id] = order.splice(from, 1);
    order.splice(to, 0, id);
    broadcast(0);
    saveSession();
  });
  ipcMain.on('tabs:menu', (_e, { id, x, y }) => showTabContextMenu(id, x, y));

  ipcMain.on('nav:go', (_e, value) => navigate(value));
  ipcMain.on('nav:back', goBack);
  ipcMain.on('nav:forward', goForward);
  ipcMain.on('nav:reload', (_e, ignoreCache) => reload(!!ignoreCache));
  ipcMain.on('nav:stop', () => activeTab() && activeTab().wc.stop());
  ipcMain.on('nav:home', () => navigate(START_URL));
  ipcMain.on('nav:open', (_e, { url, newTab }) => {
    if (newTab) createTab(url);
    else navigate(url);
  });

  ipcMain.on('bookmarks:toggle', toggleBookmark);
  ipcMain.on('bookmarks:remove', (_e, id) => {
    const idx = bookmarks.findIndex((b) => b.id === id);
    if (idx >= 0) {
      bookmarks.splice(idx, 1);
      writeJSON('bookmarks.json', bookmarks);
      broadcastBookmarks();
      broadcast(0);
    }
  });

  ipcMain.handle('suggest:query', (_e, query) => smartSuggestions(query));
  ipcMain.handle('history:list', (_e, query) => {
    const q = (query || '').trim().toLowerCase();
    const list = q
      ? history.filter((h) => (h.title || '').toLowerCase().includes(q) || h.url.toLowerCase().includes(q))
      : history;
    return list.slice(0, 400);
  });
  ipcMain.on('history:remove', (_e, ts) => {
    history = history.filter((h) => h.ts !== ts);
    writeJSON('history.json', history);
    chromeSend('history:changed');
  });
  ipcMain.on('history:clear', () => {
    history = [];
    writeJSON('history.json', history);
    chromeSend('history:changed');
    chromeSend('toast', { text: 'История очищена' });
  });

  ipcMain.handle('downloads:list', () => downloads);
  ipcMain.on('downloads:open', (_e, id) => {
    const d = downloads.find((x) => x.id === id);
    if (d && d.savePath) shell.openPath(d.savePath);
  });
  ipcMain.on('downloads:show', (_e, id) => {
    const d = downloads.find((x) => x.id === id);
    if (d && d.savePath) shell.showItemInFolder(d.savePath);
  });
  ipcMain.on('downloads:clear', () => {
    for (let i = downloads.length - 1; i >= 0; i--) {
      if (downloads[i].state !== 'progressing') downloads.splice(i, 1);
    }
    broadcastDownloads();
  });

  ipcMain.handle('settings:update', (_e, patch) => updateSettings(patch || {}));
  ipcMain.handle('settings:reset', () => {
    settings = Object.assign({}, DEFAULT_SETTINGS);
    contentRadius = 22;
    writeJSON('settings.json', settings);
    broadcastSettings();
    broadcast(0);
    layout();
    return settings;
  });

  ipcMain.handle('overlay:open', (_e, type) => overlayOpen(type));
  ipcMain.handle('overlay:close', () => overlayClose());

  ipcMain.handle('find:start', (_e, { text, forward = true, findNext = false }) => {
    const t = activeTab();
    if (!t) return;
    if (!text) {
      t.wc.stopFindInPage('clearSelection');
      chromeSend('find:result', { matches: 0, active: 0 });
      return;
    }
    t.wc.findInPage(text, { forward, findNext });
  });
  ipcMain.on('find:stop', () => {
    const t = activeTab();
    if (t) {
      try { t.wc.stopFindInPage('clearSelection'); } catch {}
    }
    try { activeTab() && activeTab().wc.focus(); } catch {}
  });

  ipcMain.on('zoom:delta', (_e, delta) => zoomDelta(delta));
  ipcMain.on('zoom:set', (_e, level) => setZoom(level));
  ipcMain.on('zoom:reset', () => setZoom(0));

  ipcMain.on('tab:focus', () => activeTab() && activeTab().wc.focus());

  ipcMain.handle('memory:free', () => {
    const freed = freeMemory();
    chromeSend('toast', {
      text: freed
        ? `Вкладок отправлено в сон: ${freed}`
        : 'Все неактивные вкладки уже спят',
      icon: 'check',
    });
    return freed;
  });

  ipcMain.handle('memory:stats', () => {
    try {
      const metrics = app.getAppMetrics();
      let totalKb = 0;
      let counted = 0;
      for (const item of metrics) {
        let pss = 0;
        try {
          const data = fs.readFileSync(`/proc/${item.pid}/smaps_rollup`, 'utf8');
          const match = data.match(/^Pss:\s+(\d+) kB/m);
          if (match) pss = Number(match[1]);
        } catch {}
        if (!pss) pss = item.memory?.workingSetSize || 0;
        totalKb += pss;
        counted += 1;
      }
      return { totalMB: Math.round(totalKb / 1024), processes: counted };
    } catch {
      return null;
    }
  });

  ipcMain.on('app:quit', () => app.quit());
}

// ---------------------------------------------------------------- start page IPC

function setupStartIPC() {
  ipcMain.handle('start:settings', () => ({
    settings,
    engines: Object.fromEntries(Object.entries(ENGINES).map(([k, v]) => [k, v.name])),
    appVersion: app.getVersion(),
    chromium: process.versions.chrome || '',
    electron: process.versions.electron || '',
    platform: process.platform,
  }));
  ipcMain.on('start:open-settings', () => openSettings());
  ipcMain.handle('start:update-settings', (_e, patch) => updateSettings(patch || {}));
  ipcMain.handle('start:reset-settings', () => {
    settings = Object.assign({}, DEFAULT_SETTINGS);
    contentRadius = 22;
    writeJSON('settings.json', settings);
    broadcastSettings();
    broadcast(0);
    layout();
    return settings;
  });
  ipcMain.handle('start:clear-history', () => {
    history = [];
    writeJSON('history.json', history);
    chromeSend('history:changed');
    return true;
  });
  ipcMain.handle('start:clear-cache', async () => {
    try { await session.defaultSession.clearCache(); } catch {}
    return true;
  });
  ipcMain.handle('start:clear-site-data', async () => {
    try {
      await session.defaultSession.clearStorageData({
        storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage'],
      });
    } catch {}
    return true;
  });
  ipcMain.on('start:search', (_e, query) => {
    if (activeTab()) navigate(query);
  });
  ipcMain.on('start:open', (_e, { url, newTab }) => {
    if (newTab) createTab(url);
    else navigate(url);
  });
  ipcMain.handle('start:links', (_e, links) => {
    updateSettings({ quickLinks: Array.isArray(links) ? links : [] });
    return settings;
  });
  ipcMain.on('start:retry', (_e, url) => {
    const t = activeTab();
    if (!t) return;
    t.isError = false;
    t.wc.loadURL(url).catch(() => {});
  });
}

// ---------------------------------------------------------------- protocol

protocol.registerSchemesAsPrivileged([
  { scheme: 'aurora', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function registerProtocol() {
  const hosts = { start: 'start', settings: 'settings' };
  protocol.handle('aurora', (request) => {
    try {
      const url = new URL(request.url);
      const folder = hosts[url.hostname];
      if (!folder) return new Response('Not found', { status: 404 });
      let rel = decodeURIComponent(url.pathname);
      if (!rel || rel === '/') rel = `/${folder}.html`;
      const base = path.join(ROOT, folder);
      const file = path.normalize(path.join(base, rel));
      if (!file.startsWith(base)) return new Response('Forbidden', { status: 403 });
      const data = fs.readFileSync(file);
      const extension = path.extname(file).toLowerCase();
      const isBundledAsset = ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico'].includes(extension);
      return new Response(new Uint8Array(data), {
        headers: {
          'Content-Type': MIME[extension] || 'application/octet-stream',
          'Cache-Control': isBundledAsset ? 'private, max-age=86400' : 'no-cache',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ---------------------------------------------------------------- boot

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    dataDir = app.getPath('userData');
    loadData();
    contentRadius = Math.max(0, Math.min(28, Number(settings.radius) + 6));

    registerProtocol();
    setupSession();
    setupDownloads();
    setupIPC();
    setupStartIPC();
    createWindow();

    // Put stale background tabs to sleep and release their renderers.
    setInterval(sleepInactiveTabs, 60 * 1000);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
