'use strict';

/* ------------------------------------------------------------------ helpers */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ICON = (name, cls = '') => `<svg${cls ? ` class="${cls}"` : ''}><use href="#i-${name}"/></svg>`;

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ESC_MAP[c]);

const hostOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};
const letterOf = (...values) => {
  for (const v of values) {
    const s = String(v || '').trim();
    if (s) return s[0].toUpperCase();
  }
  return '?';
};
const faviconService = (url) => {
  const host = hostOf(url);
  return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64` : '';
};
const timeOf = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const formatBytes = (bytes) => {
  if (!bytes) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
};

function faviconMarkup(item, size = '') {
  const letter = letterOf(item.title, hostOf(item.url));
  if (item.favicon) {
    return `<img class="favicon ${size}" src="${esc(item.favicon)}" alt="" draggable="false">`;
  }
  return `<span class="favicon-fallback ${size}">${esc(letter)}</span>`;
}

function rowFavicon(url, favicon) {
  const letter = letterOf(hostOf(url));
  const src = favicon || faviconService(url);
  return src
    ? `<img src="${esc(src)}" alt="" draggable="false" data-letter="${esc(letter)}">`
    : `<span class="favicon-fallback">${esc(letter)}</span>`;
}

// Any broken remote favicon falls back to its letter tile.
document.addEventListener('error', (event) => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement)) return;
  const host = img.closest('.tab, .bm-item, .list-row, .bm-card, .bm-tile');
  if (!host) return;
  const letter = img.dataset.letter || host.dataset.letter || '?';
  const span = document.createElement('span');
  span.className = host.classList.contains('bm-tile') ? 'tile-letter' : 'favicon-fallback';
  span.textContent = letter;
  img.replaceWith(span);
}, true);

/* ------------------------------------------------------------------ state */

const state = {
  tabs: [],
  activeId: null,
  settings: null,
  bookmarks: [],
  downloads: [],
  engines: {},
  appVersion: '',
  blocked: 0,
  zoom: 100,
  maximized: false,
  overlay: null,
};

let overlayType = null;
let panelType = null;
let findOpen = false;
let lastTabSignature = '';
let lastActiveId = null;
let findTimer = null;
let toastTimer = null;

let suggestOpen = false;
let suggestRows = [];
let suggestIndex = 0;
let suggestRemote = { completions: [], pages: [] };
let suggestQuery = '';
let suggestTimer = null;
let suggestSeq = 0;

const activeTab = () => state.tabs.find((t) => t.id === state.activeId) || null;
const engineName = () => state.engines[state.settings?.searchEngine] || 'Google';
const bookmarked = (url) => state.bookmarks.some((b) => b.url === url);

/* ------------------------------------------------------------------ init */

init();

async function init() {
  bindStatic();
  observeHeight();

  const data = await browser.init();
  state.engines = data.engines || {};
  state.appVersion = data.appVersion || '1.0.0';
  state.bookmarks = data.bookmarks || [];
  state.downloads = data.downloads || [];
  state.settings = data.settings;
  applySettings(state.settings);

  browser.onState(handleState);
  browser.onSettings(handleSettings);
  browser.onBookmarks((list) => {
    state.bookmarks = list || [];
    renderBookmarksBar();
    updateStar();
    if (overlayType === 'bookmarks') renderBookmarksPanel();
  });
  browser.onDownloads((list) => {
    state.downloads = list || [];
    updateDownloadBadge();
    if (overlayType === 'downloads') renderDownloadsPanel();
  });
  browser.onHistoryChanged(() => {
    if (overlayType === 'history') refreshHistory();
  });
  browser.onFindResult(handleFindResult);
  browser.onFocusOmnibox(() => focusOmnibox());
  browser.onOpenFind(() => openFind());
  browser.onOverlayOpen(({ type, backdrop }) => showOverlay(type, backdrop));
  browser.onOverlayClose(() => hideOverlay());
  browser.onOpenOverlay((type) => openOverlay(type));
  browser.onEscape(() => {
    if (overlayType) { closeOverlay(); return; }
    if (findOpen) closeFind();
  });
  browser.onToast(showToast);
  browser.onImmersive((on) => {
    document.body.classList.toggle('immersive', !!on);
  });

  handleState(data.state);
  syncOmnibox(true);
  updateDownloadBadge();
  renderBookmarksBar();
  if (activeTab()?.isStart) setTimeout(() => focusOmnibox(), 60);
}

/* ------------------------------------------------------------------ tabs */

function handleState(next) {
  const prevActive = state.activeId;
  state.tabs = next.tabs || [];
  state.activeId = next.activeId;
  state.maximized = !!next.maximized;
  state.blocked = next.blocked || 0;
  state.zoom = next.zoom || 100;
  state.overlay = next.overlay;

  const signature = state.tabs
    .map((t) => `${t.id}|${t.title}|${t.favicon}|${t.loading}|${t.id === state.activeId}`)
    .join('~');
  if (signature !== lastTabSignature) {
    lastTabSignature = signature;
    renderTabs();
  }

  updateChrome();

  if (prevActive !== state.activeId) {
    if (findOpen) closeFind(true);
    if (suggestOpen) closeSuggestions();
    syncOmnibox(true);
    if (overlayType && overlayType !== 'menu') {
      // keep panel content in sync with the newly focused tab
      if (panelType === 'history') renderHistoryPanel();
    }
  } else {
    syncOmnibox(false);
  }
}

function renderTabs() {
  const container = $('#tabs');
  container.innerHTML = state.tabs.map((tab) => {
    const isActive = tab.id === state.activeId;
    const letter = letterOf(tab.title, hostOf(tab.url));
    return `
      <div class="tab ${isActive ? 'active' : ''} ${tab.loading ? 'loading' : ''} ${tab.asleep ? 'asleep' : ''}"
           data-id="${esc(tab.id)}" data-letter="${esc(letter)}"
           title="${esc(tab.title)}" draggable="true">
        ${tab.loading ? '<span class="spinner"></span>' : ''}
        ${tab.asleep
          ? `<span class="tab-sleep">${ICON('moon')}</span>`
          : tab.isStart
            ? `<span class="tab-start">${ICON('logo')}</span>`
            : faviconMarkup({ title: tab.title, url: tab.url, favicon: tab.favicon })}
        <span class="tab-title">${esc(tab.title)}</span>
        <button class="tab-close" data-close="${esc(tab.id)}" title="Закрыть вкладку" aria-label="Закрыть вкладку">${ICON('x')}</button>
      </div>`;
  }).join('');
}

function updateChrome() {
  const tab = activeTab();
  $('#backBtn').disabled = !tab || !tab.canGoBack;
  $('#fwdBtn').disabled = !tab || !tab.canGoForward;
  $('#reloadBtn').classList.toggle('is-loading', !!tab?.loading);
  $('#reloadBtn').title = tab?.loading ? 'Остановить загрузку' : 'Обновить (Ctrl+R)';
  $('#winMax').innerHTML = `<svg><use href="#i-${state.maximized ? 'restore' : 'max'}"/></svg>`;
  $('#zoomValue').textContent = `${state.zoom}%`;
  $('#blockedInfo').textContent = `Заблокировано рекламы: ${state.blocked.toLocaleString('ru-RU')}`;
  updateStar();
}

function updateStar() {
  const tab = activeTab();
  const btn = $('#omniStar');
  const canBookmark = !!tab && !tab.isStart && /^https?:/i.test(tab.url);
  btn.disabled = !canBookmark;
  const isOn = canBookmark && bookmarked(tab.url);
  btn.classList.toggle('active', isOn);
  btn.title = isOn ? 'Убрать из закладок (Ctrl+D)' : 'Добавить в закладки (Ctrl+D)';
  btn.innerHTML = `<svg${isOn ? ' style="fill:currentColor"' : ''}><use href="#i-star"/></svg>`;
}

/* ------------------------------------------------------------------ omnibox */

function syncOmnibox(force) {
  const tab = activeTab();
  const input = $('#omniInput');
  if (force || document.activeElement !== input) {
    input.value = tab && !tab.isStart ? tab.url : '';
  }
  input.placeholder = `Поиск в ${engineName()} или адрес сайта`;

  const leading = $('#omniLeading');
  let icon = 'globe';
  let cls = '';
  if (!tab || tab.isStart) {
    icon = 'search';
    cls = 'search';
  } else if (tab.isError) {
    icon = 'globe';
  } else if (tab.secure) {
    icon = 'lock';
    cls = 'secure';
  }
  leading.className = 'omni-leading' + (cls ? ' ' + cls : '');
  leading.innerHTML = `<svg><use href="#i-${icon}"/></svg>`;
  updateStar();
}

function focusOmnibox() {
  closeOverlay();
  const input = $('#omniInput');
  input.focus();
  input.select();
}

/* ------------------------------------------------------------------ suggestions */

function looksLikeUrlInput(value) {
  const s = String(value || '').trim();
  if (!s || /\s/.test(s)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return true;
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$)/i.test(s)) return true;
  return /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s) && !/^[\d.]+$/.test(s);
}

function suggestIcon(kind) {
  switch (kind) {
    case 'search': return ICON('search');
    case 'completion': return ICON('spark');
    case 'url': return ICON('external');
    case 'bookmark': return ICON('star');
    case 'history': return ICON('clock');
    default: return ICON('globe');
  }
}

function suggestTag(kind) {
  switch (kind) {
    case 'search': return 'поиск';
    case 'completion': return 'подсказка';
    case 'url': return 'адрес';
    case 'bookmark': return 'закладка';
    case 'history': return 'история';
    default: return 'быстрый доступ';
  }
}

function markQuery(text, query) {
  const value = String(text || '');
  const q = String(query || '');
  const index = value.toLowerCase().indexOf(q.toLowerCase());
  if (!q || index < 0) return esc(value);
  return esc(value.slice(0, index)) +
    '<mark>' + esc(value.slice(index, index + q.length)) + '</mark>' +
    esc(value.slice(index + q.length));
}

function buildSuggestRows(query, payload) {
  const q = String(query || '').trim();
  if (!q) return [];
  const data = Array.isArray(payload) ? { pages: payload, completions: [] } : (payload || {});
  const completions = Array.isArray(data.completions) ? data.completions : [];
  const pages = Array.isArray(data.pages) ? data.pages : [];
  const rows = [];
  const isUrl = looksLikeUrlInput(q);
  const engine = engineName();
  const seen = new Set();

  for (const text of completions) {
    const value = String(text || '').trim();
    if (!value || !value.toLowerCase().startsWith(q.toLowerCase())) continue;
    if (seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    rows.push({
      kind: 'completion',
      title: value,
      sub: 'Умная подсказка',
      value,
      search: true,
    });
  }

  if (isUrl) {
    rows.push({
      kind: 'url',
      title: q,
      sub: 'Открыть адрес',
      value: q,
    });
  }

  const searchRow = {
    kind: 'search',
    title: `Искать в ${engine}: ${q}`,
    sub: 'Поиск в интернете',
    value: q,
  };
  rows.push(searchRow);

  for (const item of pages) {
    const value = String(item.url || '');
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    rows.push({
      kind: item.type,
      title: item.title || item.host || value,
      sub: item.host || value,
      value,
      favicon: item.favicon || '',
    });
  }
  return rows.slice(0, 8);
}

function renderSuggestions(query, payload) {
  suggestRemote = payload || { completions: [], pages: [] };
  suggestRows = buildSuggestRows(query, suggestRemote);
  if (!suggestRows.length) {
    $('#suggestList').innerHTML = '';
    $('#sheetSuggest').hidden = true;
    return;
  }
  if (suggestIndex >= suggestRows.length) suggestIndex = 0;

  $('#suggestList').innerHTML = suggestRows.map((row, index) => `
    <button class="suggest-row ${index === suggestIndex ? 'active' : ''}"
            data-suggest-index="${index}" type="button">
      <span class="sr-icon sr-${esc(row.kind)}">${suggestIcon(row.kind)}</span>
      <span class="sr-main">
        <span class="sr-title">${markQuery(row.title, query)}</span>
        <span class="sr-sub">${esc(row.sub)}</span>
      </span>
      <span class="sr-tag">${esc(suggestTag(row.kind))}</span>
    </button>`).join('');
  $('#sheetSuggest').hidden = false;
  positionSuggestPanel();
}

function positionSuggestPanel() {
  const omni = $('#omni');
  const top = $('#top');
  if (!omni || !top) return;
  const rect = omni.getBoundingClientRect();
  document.documentElement.style.setProperty('--top-h', `${top.getBoundingClientRect().height}px`);
  const panel = $('#sheetSuggest');
  panel.style.left = `${rect.left}px`;
  panel.style.top = `${rect.bottom + 8}px`;
  panel.style.width = `${rect.width}px`;
}

function openSuggestions(query) {
  const value = String(query || '').trim();
  if (!value) return;
  suggestOpen = true;
  suggestIndex = 0;
  if (overlayType !== 'suggest') browser.openOverlay('suggest');
  renderSuggestions(value, suggestRemote);
  positionSuggestPanel();
}

function scheduleSuggestions(query) {
  const value = String(query || '').trim();
  if (!value) {
    closeSuggestions();
    return;
  }
  if (!suggestOpen) {
    suggestIndex = 0;
    openSuggestions(value);
  } else {
    renderSuggestions(value, suggestRemote);
  }

  clearTimeout(suggestTimer);
  const seq = ++suggestSeq;
  suggestTimer = setTimeout(async () => {
    const items = await browser.suggest(value).catch(() => []);
    if (!suggestOpen || seq !== suggestSeq) return;
    renderSuggestions(value, items);
    positionSuggestPanel();
  }, 90);
}

function moveSuggestion(delta) {
  if (!suggestRows.length) return;
  setSuggestionIndex((suggestIndex + delta + suggestRows.length) % suggestRows.length, true);
}

function setSuggestionIndex(index, scroll) {
  if (!suggestRows.length) return;
  suggestIndex = Math.max(0, Math.min(suggestRows.length - 1, index));
  $$('#suggestList .suggest-row').forEach((row, i) => {
    row.classList.toggle('active', i === suggestIndex);
  });
  if (scroll) {
    $('#suggestList .suggest-row.active')?.scrollIntoView({ block: 'nearest' });
  }
}

function pickSuggestion(index) {
  const row = suggestRows[index];
  if (!row) return;
  const value = row.value;
  closeSuggestions();
  const input = $('#omniInput');
  input.value = '';
  input.blur();
  browser.navigate(value);
  browser.focusPage();
}

function closeSuggestions() {
  const wasOpen = suggestOpen || overlayType === 'suggest';
  suggestOpen = false;
  suggestRemote = { completions: [], pages: [] };
  suggestRows = [];
  suggestIndex = 0;
  clearTimeout(suggestTimer);
  $('#sheetSuggest').hidden = true;
  if (wasOpen) browser.closeOverlay();
}

/* ------------------------------------------------------------------ bookmarks bar */

function renderBookmarksBar() {
  const bar = $('#bmBar');
  const list = $('#bmList');
  const enabled = !!state.settings?.bookmarksBar;
  bar.hidden = !enabled;
  if (!enabled) return;

  const items = state.bookmarks.slice(0, 18);
  if (!items.length) {
    list.innerHTML = '<span class="bm-empty">Нажмите ☆ в адресной строке, чтобы добавить закладку</span>';
    return;
  }
  list.innerHTML = items.map((b) => `
    <button class="bm-item" data-url="${esc(b.url)}" data-title="${esc(b.title)}"
            data-letter="${esc(letterOf(b.title, hostOf(b.url)))}" title="${esc(b.title)}">
      ${faviconMarkup({ title: b.title, url: b.url, favicon: b.favicon })}
      <span>${esc(b.title)}</span>
    </button>`).join('');
}

/* ------------------------------------------------------------------ bind static */

function bindStatic() {
  $('#winMin').addEventListener('click', () => browser.minimize());
  $('#winMax').addEventListener('click', () => browser.maximize());
  $('#winClose').addEventListener('click', () => browser.close());
  $('#brand').addEventListener('dblclick', () => browser.maximize());

  $('#newTabBtn').addEventListener('click', () => browser.newTab());
  $('#backBtn').addEventListener('click', () => browser.back());
  $('#fwdBtn').addEventListener('click', () => browser.forward());
  $('#reloadBtn').addEventListener('click', () => {
    const tab = activeTab();
    if (tab?.loading) browser.stop();
    else browser.reload();
  });
  $('#homeBtn').addEventListener('click', () => browser.home());

  $('#omniInput').addEventListener('focus', (e) => {
    e.target.select();
    if (e.target.value.trim()) openSuggestions(e.target.value.trim());
  });
  $('#omniInput').addEventListener('input', (e) => scheduleSuggestions(e.target.value.trim()));
  $('#omniInput').addEventListener('keydown', (e) => {
    if (suggestOpen && e.key === 'ArrowDown') {
      e.preventDefault();
      moveSuggestion(1);
      return;
    }
    if (suggestOpen && e.key === 'ArrowUp') {
      e.preventDefault();
      moveSuggestion(-1);
      return;
    }
    if (suggestOpen && e.key === 'Enter') {
      const row = suggestRows[suggestIndex];
      if (row) {
        e.preventDefault();
        pickSuggestion(suggestIndex);
        return;
      }
    }
    if (e.key === 'Enter') {
      const value = e.target.value.trim();
      if (value) {
        browser.navigate(value);
        e.target.blur();
      }
    } else if (e.key === 'Escape') {
      if (suggestOpen) {
        e.preventDefault();
        closeSuggestions();
        return;
      }
      syncOmnibox(true);
      e.target.blur();
      browser.focusPage();
    }
  });

  $('#sheetSuggest').addEventListener('mousedown', (e) => e.preventDefault());
  $('#sheetSuggest').addEventListener('click', (e) => {
    const row = e.target.closest('[data-suggest-index]');
    if (!row) return;
    pickSuggestion(Number(row.dataset.suggestIndex));
  });
  $('#sheetSuggest').addEventListener('mouseover', (e) => {
    const row = e.target.closest('[data-suggest-index]');
    if (!row) return;
    setSuggestionIndex(Number(row.dataset.suggestIndex), false);
  });

  document.addEventListener('click', (e) => {
    if (!suggestOpen) return;
    if (e.target.closest('#sheetSuggest, #omni')) return;
    closeSuggestions();
  });
  window.addEventListener('resize', () => {
    if (suggestOpen) positionSuggestPanel();
  });

  $('#omniStar').addEventListener('click', () => browser.toggleBookmark());

  $('#dlBtn').addEventListener('click', () => openOverlay('downloads'));
  $('#bmBtn').addEventListener('click', () => openOverlay('bookmarks'));
  $('#menuBtn').addEventListener('click', () => openOverlay('menu'));

  $('#tabs').addEventListener('click', (e) => {
    const close = e.target.closest('[data-close]');
    if (close) {
      e.stopPropagation();
      browser.closeTab(close.dataset.close);
      return;
    }
    const tab = e.target.closest('.tab');
    if (tab) browser.selectTab(tab.dataset.id);
  });
  $('#tabs').addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const close = e.target.closest('[data-close]');
    if (close) browser.closeTab(close.dataset.close);
  });
  $('#tabs').addEventListener('contextmenu', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    e.preventDefault();
    browser.tabMenu(tab.dataset.id, e.clientX, e.clientY);
  });

  let dragFrom = null;
  $('#tabs').addEventListener('dragstart', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    dragFrom = state.tabs.findIndex((t) => t.id === tab.dataset.id);
    tab.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', tab.dataset.id); } catch {}
  });
  $('#tabs').addEventListener('dragend', () => {
    dragFrom = null;
    $$('.tab.dragging').forEach((el) => el.classList.remove('dragging'));
  });
  $('#tabs').addEventListener('dragover', (e) => {
    if (dragFrom == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });
  $('#tabs').addEventListener('drop', (e) => {
    if (dragFrom == null) return;
    e.preventDefault();
    const target = e.target.closest('.tab');
    let to = state.tabs.length - 1;
    if (target) {
      to = state.tabs.findIndex((t) => t.id === target.dataset.id);
      const rect = target.getBoundingClientRect();
      if (e.clientX > rect.left + rect.width / 2) to += 1;
    }
    browser.moveTab(dragFrom, Math.min(to, state.tabs.length - 1));
    dragFrom = null;
  });

  $('#bmList').addEventListener('click', (e) => {
    const item = e.target.closest('.bm-item');
    if (!item) return;
    if (e.ctrlKey || e.metaKey || e.button === 1) browser.open(item.dataset.url, true);
    else browser.open(item.dataset.url, false);
  });
  $('#bmList').addEventListener('auxclick', (e) => {
    const item = e.target.closest('.bm-item');
    if (item && e.button === 1) browser.open(item.dataset.url, true);
  });
  $('#bmAll').addEventListener('click', () => openOverlay('bookmarks'));

  // find bar
  $('#findInput').addEventListener('input', () => {
    clearTimeout(findTimer);
    const value = $('#findInput').value;
    findTimer = setTimeout(() => runFind(value, true, false), 130);
  });
  $('#findInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runFind($('#findInput').value, !e.shiftKey, true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFind();
    }
  });
  $('#findNext').addEventListener('click', () => runFind($('#findInput').value, true, true));
  $('#findPrev').addEventListener('click', () => runFind($('#findInput').value, false, true));
  $('#findClose').addEventListener('click', () => closeFind());

  // overlays
  $('#backdrop').addEventListener('click', () => closeOverlay());
  $$('[data-close]').forEach((btn) => btn.addEventListener('click', () => closeOverlay()));

  $('#sheetMenu').addEventListener('click', onMenuClick);
  $('#sheetPanel').addEventListener('click', onPanelClick);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (overlayType) { closeOverlay(); return; }
      if (findOpen) { closeFind(); return; }
    }
  });

  // tabs strip double click maximize
  $('#tabbar').addEventListener('dblclick', (e) => {
    if (e.target.closest('.tab, button')) return;
    browser.maximize();
  });
}

/* ------------------------------------------------------------------ height */

function observeHeight() {
  const top = $('#top');
  const report = () => browser.setHeight(top.getBoundingClientRect().height);
  const ro = new ResizeObserver(() => requestAnimationFrame(report));
  ro.observe(top);
  window.addEventListener('resize', () => requestAnimationFrame(report));
  requestAnimationFrame(report);
}

/* ------------------------------------------------------------------ find */

function openFind() {
  if (!activeTab() || activeTab().isStart) return;
  closeOverlay();
  findOpen = true;
  $('#findBar').hidden = false;
  const input = $('#findInput');
  input.focus();
  input.select();
  if (input.value) runFind(input.value, true, false);
}

function runFind(text, forward, findNext) {
  browser.find(text, forward, findNext);
}

function closeFind(silent) {
  if (!findOpen) return;
  findOpen = false;
  $('#findBar').hidden = true;
  $('#findCount').textContent = '0 / 0';
  browser.stopFind();
  if (!silent) browser.focusPage();
}

function handleFindResult(result) {
  if (!findOpen) return;
  const count = $('#findCount');
  if (!result || !result.matches) {
    count.textContent = $('#findInput').value ? 'нет совпадений' : '0 / 0';
    count.style.color = $('#findInput').value ? '#e5484d' : '';
    return;
  }
  count.style.color = '';
  count.textContent = `${result.active} / ${result.matches}`;
}

/* ------------------------------------------------------------------ overlay */

function openOverlay(type) {
  if (overlayType === type) {
    closeOverlay();
    return;
  }
  if (findOpen) closeFind(true);
  browser.openOverlay(type);
}

function closeOverlay() {
  if (!overlayType) return;
  browser.closeOverlay();
}

function showOverlay(type, backdrop) {
  overlayType = type;
  document.body.classList.add('overlay-open');
  const overlay = $('#overlay');
  overlay.hidden = false;
  overlay.dataset.kind = type;

  if (backdrop) {
    $('#backdrop').style.backgroundImage = `url("${backdrop}")`;
  }

  $$('.sheet', overlay).forEach((sheet) => { sheet.hidden = true; });
  $('#panelActions').innerHTML = '';

  if (type === 'menu') {
    $('#sheetMenu').hidden = false;
    updateChrome();
  } else if (type === 'suggest') {
    suggestOpen = true;
    $('#sheetSuggest').hidden = false;
    positionSuggestPanel();
    renderSuggestions($('#omniInput').value.trim(), suggestRemote);
  } else if (type === 'history') {
    panelType = 'history';
    $('#sheetPanel').hidden = false;
    renderHistoryPanel();
  } else if (type === 'downloads') {
    panelType = 'downloads';
    $('#sheetPanel').hidden = false;
    renderDownloadsPanel();
  } else if (type === 'bookmarks') {
    panelType = 'bookmarks';
    $('#sheetPanel').hidden = false;
    renderBookmarksPanel();
  } else if (type === 'about') {
    panelType = 'about';
    $('#sheetPanel').hidden = false;
    renderAboutPanel();
  }
}

function hideOverlay() {
  const wasSuggest = overlayType === 'suggest';
  overlayType = null;
  panelType = null;
  document.body.classList.remove('overlay-open');
  const overlay = $('#overlay');
  overlay.hidden = true;
  overlay.removeAttribute('data-kind');
  $('#backdrop').style.backgroundImage = '';
  suggestOpen = false;
  suggestRemote = { completions: [], pages: [] };
  suggestRows = [];
  suggestIndex = 0;
  $('#sheetSuggest').hidden = true;
  if (!findOpen && !wasSuggest) browser.focusPage();
}

function onMenuClick(e) {
  const zoomBtn = e.target.closest('[data-zoom]');
  if (zoomBtn) {
    browser.zoomDelta(Number(zoomBtn.dataset.zoom) * 0.5);
    return;
  }
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  switch (action) {
    case 'new-tab':
      browser.newTab();
      closeOverlay();
      break;
    case 'history':
    case 'bookmarks':
    case 'downloads':
    case 'about':
      browser.openOverlay(action);
      break;
    case 'settings':
      closeOverlay();
      browser.openSettings();
      break;
    case 'free-memory':
      browser.freeMemory();
      closeOverlay();
      break;
    case 'find':
      closeOverlay();
      setTimeout(openFind, 20);
      break;
  }
}

/* ------------------------------------------------------------------ history panel */

function panelShell(title, sub, actionsHtml = '') {
  $('#panelTitle').textContent = title;
  $('#panelSub').textContent = sub || '';
  $('#panelActions').innerHTML = actionsHtml;
}

function renderHistoryPanel() {
  panelShell('История', 'Всё, что вы открывали в Аврора Браузере',
    '<button class="ghost-btn" data-panel="clear-history">Очистить</button>');
  $('#panelBody').innerHTML = `
    <div class="panel-search">
      ${ICON('search')}
      <input id="histSearch" type="text" placeholder="Поиск по истории" spellcheck="false">
    </div>
    <div id="histList"></div>`;
  $('#histSearch').addEventListener('input', () => {
    clearTimeout(findTimer);
    findTimer = setTimeout(refreshHistory, 130);
  });
  refreshHistory();
}

async function refreshHistory() {
  if (overlayType !== 'history') return;
  const list = $('#histList');
  if (!list) return;
  const query = $('#histSearch')?.value || '';
  const items = await browser.getHistory(query);
  if (overlayType !== 'history') return;

  if (!items.length) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-ico">${ICON('clock')}</div>
      <div>${query ? 'Ничего не найдено' : 'История пока пуста'}</div>
      <small>${query ? 'Попробуйте другой запрос' : 'Открытые страницы появятся здесь автоматически'}</small>
    </div>`;
    return;
  }

  let currentLabel = '';
  const html = [];
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  for (const item of items) {
    const dayStart = new Date(new Date(item.ts).getFullYear(), new Date(item.ts).getMonth(), new Date(item.ts).getDate()).getTime();
    let label;
    if (dayStart === startOfToday) label = 'Сегодня';
    else if (dayStart === startOfToday - 86400000) label = 'Вчера';
    else label = new Date(item.ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

    if (label !== currentLabel) {
      currentLabel = label;
      html.push(`<div class="list-group-label">${esc(label)}</div>`);
    }
    html.push(`
      <div class="list-row" data-url="${esc(item.url)}" data-ts="${item.ts}"
           data-letter="${esc(letterOf(item.title, hostOf(item.url)))}">
        <span class="row-icon">${rowFavicon(item.url)}</span>
        <div class="row-main">
          <div class="row-title">${esc(item.title || hostOf(item.url))}</div>
          <div class="row-sub">${esc(item.url)}</div>
        </div>
        <span class="row-time">${timeOf(item.ts)}</span>
        <button class="row-del" data-del-history="${item.ts}" title="Удалить">${ICON('trash')}</button>
      </div>`);
  }
  list.innerHTML = html.join('');
}

/* ------------------------------------------------------------------ downloads panel */

function renderDownloadsPanel() {
  const active = state.downloads.filter((d) => d.state === 'progressing').length;
  panelShell('Загрузки', active ? `${active} файл(а) загружается` : 'Скачанные файлы',
    state.downloads.length ? '<button class="ghost-btn" data-panel="clear-downloads">Очистить</button>' : '');
  renderDownloadList();
}

function renderDownloadList() {
  const body = $('#panelBody');
  if (!body) return;
  if (!state.downloads.length) {
    body.innerHTML = `<div class="empty-state">
      <div class="empty-ico">${ICON('download')}</div>
      <div>Загрузок пока нет</div>
      <small>Файлы, скачанные из браузера, появятся здесь</small>
    </div>`;
    return;
  }

  body.innerHTML = state.downloads.map((d) => {
    const done = d.state === 'completed';
    const failed = d.state === 'interrupted' || d.state === 'cancelled';
    const percent = d.total ? Math.min(100, Math.round((d.received / d.total) * 100)) : 0;
    const meta = done
      ? `${formatBytes(d.received)} · Загружено`
      : failed
        ? 'Ошибка загрузки'
        : `${formatBytes(d.received)} из ${d.total ? formatBytes(d.total) : '…'} · ${percent}%`;
    return `
      <div class="dl-row" data-dl="${esc(d.id)}">
        <span class="dl-icon">${ICON(done ? 'check' : 'download')}</span>
        <div class="dl-main">
          <div class="dl-name">${esc(d.filename)}</div>
          <div class="dl-meta">${esc(meta)}</div>
          ${!done && !failed ? `<div class="dl-progress"><i style="width:${percent}%"></i></div>` : ''}
        </div>
        <div class="dl-actions">
          ${done ? `<button data-dl-open="${esc(d.id)}">Открыть</button><button data-dl-show="${esc(d.id)}">Папка</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

/* ------------------------------------------------------------------ bookmarks panel */

function renderBookmarksPanel() {
  const count = state.bookmarks.length;
  panelShell('Закладки', count ? `${count} сохранённых страниц` : 'Сохранённые страницы');
  const body = $('#panelBody');
  if (!count) {
    body.innerHTML = `<div class="empty-state">
      <div class="empty-ico">${ICON('star')}</div>
      <div>Закладок пока нет</div>
      <small>Нажмите ☆ в адресной строке или Ctrl+D, чтобы сохранить страницу</small>
    </div>`;
    return;
  }
  body.innerHTML = `<div class="bm-grid">${state.bookmarks.map((b) => `
    <div class="bm-card" data-url="${esc(b.url)}" data-letter="${esc(letterOf(b.title, hostOf(b.url)))}">
      <span class="row-icon">${rowFavicon(b.url, b.favicon)}</span>
      <div class="row-main">
        <div class="row-title">${esc(b.title)}</div>
        <div class="row-sub">${esc(hostOf(b.url))}</div>
      </div>
      <button class="row-del" data-del-bookmark="${esc(b.id)}" title="Удалить">${ICON('trash')}</button>
    </div>`).join('')}</div>`;
}

/* ------------------------------------------------------------------ about */

async function renderAboutPanel() {
  panelShell('О браузере', 'Аврора Браузер для Linux');
  const mem = await browser.memoryStats().catch(() => null);
  const memLine = mem
    ? `<div style="margin-top:6px;font-size:11.5px;color:var(--muted)">Сейчас занято ≈ ${mem.totalMB} МБ (PSS) · ${mem.processes} процессов</div>`
    : '';
  $('#panelBody').innerHTML = `
    <div class="empty-state" style="padding-top:34px">
      <div class="empty-ico" style="width:68px;height:68px;border-radius:20px">
        <svg style="width:34px;height:34px"><use href="#i-logo"/></svg>
      </div>
      <div style="font-size:16px;font-weight:650;color:var(--text)">Аврора Браузер ${esc(state.appVersion)}</div>
      <small>Минималистичный браузер с аккуратным интерфейсом,<br>собственными настройками оформления и блокировкой рекламы.</small>
      <div style="margin-top:8px;font-size:11.5px;color:var(--faint)">Chromium ${esc(processVersions())} · Electron</div>
      ${memLine}
    </div>`;
}

function processVersions() {
  try {
    return navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || '';
  } catch { return ''; }
}

/* ------------------------------------------------------------------ panel events */

function onPanelClick(e) {
  const action = e.target.closest('[data-panel]')?.dataset.panel;
  if (action === 'clear-history') {
    browser.clearHistory();
    refreshHistory();
    showToast({ text: 'История очищена' });
    return;
  }
  if (action === 'clear-downloads') {
    browser.clearDownloads();
    return;
  }

  const delHistory = e.target.closest('[data-del-history]');
  if (delHistory) {
    e.stopPropagation();
    browser.removeHistory(Number(delHistory.dataset.delHistory));
    delHistory.closest('.list-row')?.remove();
    return;
  }

  const delBookmark = e.target.closest('[data-del-bookmark]');
  if (delBookmark) {
    e.stopPropagation();
    browser.removeBookmark(delBookmark.dataset.delBookmark);
    return;
  }

  const openDl = e.target.closest('[data-dl-open]');
  if (openDl) { browser.openDownload(openDl.dataset.dlOpen); return; }
  const showDl = e.target.closest('[data-dl-show]');
  if (showDl) { browser.showDownload(showDl.dataset.dlShow); return; }

  if (e.target.closest('[data-del-history], [data-del-bookmark], [data-dl-open], [data-dl-show]')) return;

  const row = e.target.closest('.list-row');
  if (row && row.dataset.url) {
    browser.open(row.dataset.url, false);
    closeOverlay();
    return;
  }
  const card = e.target.closest('.bm-card');
  if (card && card.dataset.url) {
    browser.open(card.dataset.url, false);
    closeOverlay();
  }
}

/* ------------------------------------------------------------------ appearance */

function applyRadius(radius) {
  document.documentElement.style.setProperty('--radius', radius + 'px');
  document.documentElement.style.setProperty('--sheet-radius', `calc(10px + ${radius}px)`);
}

function applySettings(settings) {
  if (!settings) return;
  document.documentElement.style.setProperty('--accent', settings.accent);
  applyRadius(settings.radius);
  document.body.classList.toggle('compact', settings.density === 'compact');
  document.body.classList.toggle('no-anim', !settings.animations);
  renderBookmarksBar();
  syncOmnibox(false);
}

function handleSettings(next) {
  state.settings = next;
  applySettings(next);
}

/* ------------------------------------------------------------------ downloads badge */

function updateDownloadBadge() {
  const active = state.downloads.filter((d) => d.state === 'progressing').length;
  const badge = $('#dlBadge');
  badge.hidden = !active;
  badge.textContent = active > 9 ? '9+' : String(active);
}

/* ------------------------------------------------------------------ toast */

function showToast(payload) {
  const data = typeof payload === 'string' ? { text: payload } : (payload || {});
  const toast = $('#toast');
  const icon = data.icon && ['star', 'check', 'download', 'info', 'shield'].includes(data.icon) ? data.icon : 'check';
  toast.innerHTML = `${ICON(icon)}<span>${esc(data.text)}</span>`;
  toast.hidden = false;
  toast.style.animation = 'none';
  void toast.offsetWidth;
  toast.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
}

/* ------------------------------------------------------------------ global image fallback */

window.addEventListener('load', () => {
  setTimeout(() => {
    $$('.tab img, .bm-item img, .list-row img, .bm-card img, .bm-tile img').forEach((img) => {
      if (img.complete && img.naturalWidth === 0) {
        img.dispatchEvent(new Event('error'));
      }
    });
  }, 800);
});
