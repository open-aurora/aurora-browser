'use strict';

/* ------------------------------------------------------------------ helpers */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const hostOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};
const letterOf = (value) => {
  const s = String(value || '').trim();
  return s ? s[0].toUpperCase() : '?';
};
const faviconFor = (url) => {
  const host = hostOf(url);
  return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64` : '';
};

/* ------------------------------------------------------------------ constants */

const ACCENTS = ['#4f7cff', '#7c5cff', '#e0529c', '#f2603c', '#f0a33c', '#3aa675', '#2fa8c9', '#6b7280'];

const GRADIENTS = [
  { id: 'aurora', label: 'Аврора', css: 'linear-gradient(135deg,#eef2ff,#fdf2f8)' },
  { id: 'mist', label: 'Дымка', css: 'linear-gradient(135deg,#f8f9fb,#e9edf3)' },
  { id: 'peach', label: 'Персик', css: 'linear-gradient(135deg,#fff4ec,#ffeef2)' },
  { id: 'sage', label: 'Шалфей', css: 'linear-gradient(135deg,#eef7f1,#f3f8f5)' },
  { id: 'lilac', label: 'Сирень', css: 'linear-gradient(135deg,#f5f0ff,#fdf0f7)' },
  { id: 'sky', label: 'Небо', css: 'linear-gradient(135deg,#eef6ff,#f2fbff)' },
  { id: 'sand', label: 'Песок', css: 'linear-gradient(135deg,#faf6ef,#fdf7f0)' },
  { id: 'mono', label: 'Моно', css: 'linear-gradient(135deg,#f5f5f6,#fafafa)' },
];

const DEFAULT_LINKS = [
  { name: 'YouTube', url: 'https://www.youtube.com' },
  { name: 'GitHub', url: 'https://github.com' },
  { name: 'Gmail', url: 'https://mail.google.com' },
  { name: 'Wikipedia', url: 'https://ru.wikipedia.org' },
  { name: 'Telegram', url: 'https://web.telegram.org' },
  { name: 'Reddit', url: 'https://www.reddit.com' },
  { name: 'Spotify', url: 'https://open.spotify.com' },
  { name: 'Notion', url: 'https://notion.so' },
];

/* ------------------------------------------------------------------ state */

let settings = null;
let engines = {};
let quickLinks = [];
let info = {};
let confirming = null;
let linkIndex = -1;
let saveTimer = null;
let nameTimer = null;
let memTimer = null;
let toastTimer = null;

/* ------------------------------------------------------------------ boot */

init();

async function init() {
  buildControls();
  bind();

  const data = await window.aurora.getSettings();
  settings = data.settings || {};
  engines = data.engines || {};
  info = {
    version: data.appVersion || '1.0.0',
    chromium: data.chromium || '',
    electron: data.electron || '',
    platform: data.platform || '',
  };
  quickLinks = Array.isArray(settings.quickLinks) ? settings.quickLinks.slice() : [];

  applyAppearance(settings);
  fillEngines();
  syncUI();
  renderLinks();
  updateAbout();
  refreshMemory();
  memTimer = setInterval(refreshMemory, 5000);

  window.aurora.onSettings((next) => {
    const previousLinks = JSON.stringify(quickLinks);
    settings = next || settings;
    quickLinks = Array.isArray(settings.quickLinks) ? settings.quickLinks.slice() : quickLinks;
    applyAppearance(settings);
    syncUI();
    if (JSON.stringify(quickLinks) !== previousLinks) renderLinks();
  });

  observeSections();
}

/* ------------------------------------------------------------------ controls */

function buildControls() {
  $('#accentSwatches').innerHTML =
    ACCENTS.map((color) => `
      <button class="swatch" data-accent="${color}" style="--c:${color}"
              title="${color}" aria-label="Акцент ${color}"></button>`).join('') +
    `<label class="swatch custom" title="Свой цвет">
       <svg><use href="#i-palette"/></svg>
       <input type="color" id="accentCustom" value="#4f7cff" aria-label="Свой акцентный цвет">
     </label>`;

  $('#gradientsGrid').innerHTML = GRADIENTS.map((g) => `
    <button class="gradient-tile" data-gradient="${g.id}" data-label="${g.label}"
            style="--g:${g.css}" title="${g.label}" aria-label="Фон ${g.label}"></button>`).join('');
}

function fillEngines() {
  const select = $('#engineSelect');
  select.innerHTML = Object.entries(engines)
    .map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');
}

/* ------------------------------------------------------------------ bindings */

function bind() {
  // accents
  $('#accentSwatches').addEventListener('click', (e) => {
    const swatch = e.target.closest('[data-accent]');
    if (swatch) patch({ accent: swatch.dataset.accent });
  });
  $('#accentCustom').addEventListener('input', (e) => patch({ accent: e.target.value }));

  // radius
  const radius = $('#radiusRange');
  radius.addEventListener('input', () => {
    const value = Number(radius.value);
    $('#radiusVal').textContent = `${value} px`;
    radius.style.setProperty('--fill', fillPercent(value));
    patch({ radius: value });
  });

  // gradients
  $('#gradientsGrid').addEventListener('click', (e) => {
    const tile = e.target.closest('[data-gradient]');
    if (tile) patch({ gradient: tile.dataset.gradient });
  });

  // density
  $('#densityGroup').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-density]');
    if (btn) patch({ density: btn.dataset.density });
  });

  // toggles
  const toggles = {
    tgAnimations: 'animations',
    tgClock: 'showClock',
    tgBookmarks: 'bookmarksBar',
    tgSleep: 'sleepTabs',
    tgSession: 'restoreSession',
    tgMemorySaver: 'memorySaver',
    tgAdblock: 'adblock',
  };
  Object.entries(toggles).forEach(([id, key]) => {
    $('#' + id).addEventListener('change', (e) => patch({ [key]: e.target.checked }));
  });

  // search engine
  $('#engineSelect').addEventListener('change', (e) => patch({ searchEngine: e.target.value }));

  // greeting name
  $('#nameInput').addEventListener('input', (e) => {
    clearTimeout(nameTimer);
    const value = e.target.value.trim();
    nameTimer = setTimeout(() => patch({ name: value }), 350);
  });

  // search filter
  const search = $('#settingsSearch');
  search.addEventListener('input', () => filterSettings(search.value));
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      search.value = '';
      filterSettings('');
      search.blur();
    }
  });

  // nav
  $('#nav').addEventListener('click', (e) => {
    const item = e.target.closest('[data-section]');
    if (!item) return;
    const section = $('#' + item.dataset.section);
    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // quick links
  $('#btnAddLink').addEventListener('click', () => openLinkModal(-1));
  $('#btnResetLinks').addEventListener('click', () => {
    quickLinks = DEFAULT_LINKS.map((link) => ({ ...link }));
    persistLinks('Ссылки восстановлены');
  });
  $('#linksGrid').addEventListener('click', (e) => {
    const add = e.target.closest('#gridAdd');
    if (add) { openLinkModal(-1); return; }
    const edit = e.target.closest('[data-edit]');
    if (edit) { openLinkModal(Number(edit.dataset.edit)); return; }
    const remove = e.target.closest('[data-remove]');
    if (remove) {
      const index = Number(remove.dataset.remove);
      quickLinks.splice(index, 1);
      persistLinks('Ссылка удалена');
    }
  });
  $('#linksGrid').addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    const span = document.createElement('span');
    span.textContent = img.dataset.letter || '?';
    img.replaceWith(span);
  }, true);

  // memory
  $('#btnFreeMemory').addEventListener('click', async () => {
    const btn = $('#btnFreeMemory');
    btn.disabled = true;
    const freed = await window.aurora.freeMemory().catch(() => 0);
    await refreshMemory();
    btn.disabled = false;
    toast(freed ? `Вкладок отправлено в сон: ${freed}` : 'Неактивные вкладки уже спят');
  });

  // privacy
  $('#btnClearHistory').addEventListener('click', () => {
    confirmAction(
      'Очистить историю?',
      'Все записи о посещённых страницах будут удалены без возможности восстановления.',
      async () => {
        await window.aurora.clearHistory();
        toast('История очищена');
      },
    );
  });
  $('#btnClearCache').addEventListener('click', async () => {
    const btn = $('#btnClearCache');
    btn.disabled = true;
    await window.aurora.clearCache().catch(() => {});
    btn.disabled = false;
    toast('Кэш браузера очищен');
    refreshMemory();
  });

  // reset
  $('#btnResetSettings').addEventListener('click', () => {
    confirmAction(
      'Сбросить все настройки?',
      'Оформление, поисковая система и параметры вкладок вернутся к значениям по умолчанию.',
      async () => {
        const next = await window.aurora.resetSettings();
        if (next) {
          settings = next;
          quickLinks = Array.isArray(next.quickLinks) ? next.quickLinks.slice() : DEFAULT_LINKS;
          applyAppearance(settings);
          syncUI();
          renderLinks();
          toast('Настройки сброшены');
        }
      },
    );
  });

  // link modal
  $('#btnLinkClose').addEventListener('click', closeLinkModal);
  $('#btnLinkCancel').addEventListener('click', closeLinkModal);
  $('#btnLinkSave').addEventListener('click', saveLink);
  $('#linkModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeLinkModal();
  });
  $$('#linkNameInput, #linkUrlInput').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveLink();
      if (e.key === 'Escape') closeLinkModal();
    });
  });

  // confirm modal
  $('#btnConfirmClose').addEventListener('click', closeConfirm);
  $('#btnConfirmCancel').addEventListener('click', closeConfirm);
  $('#btnConfirmOk').addEventListener('click', async () => {
    const action = confirming;
    closeConfirm();
    if (action) await action();
  });
  $('#confirmModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeConfirm();
  });

  // keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#linkModal').hidden) { closeLinkModal(); return; }
      if (!$('#confirmModal').hidden) { closeConfirm(); return; }
    }
    if (e.key === '/' && document.activeElement !== $('#settingsSearch') &&
        document.activeElement !== $('#nameInput') &&
        document.activeElement !== $('#linkNameInput') &&
        document.activeElement !== $('#linkUrlInput')) {
      e.preventDefault();
      $('#settingsSearch').focus();
    }
  });

  window.addEventListener('beforeunload', () => {
    clearInterval(memTimer);
    clearTimeout(saveTimer);
    clearTimeout(nameTimer);
  });
}

/* ------------------------------------------------------------------ settings io */

function patch(patchObject, options = {}) {
  settings = Object.assign({}, settings, patchObject);
  applyAppearance(settings);
  if (!options.silent) markSaving();
  window.aurora.updateSettings(patchObject).catch(() => {});
}

function applyAppearance(s) {
  if (!s) return;
  document.documentElement.style.setProperty('--accent', s.accent || '#4f7cff');
  document.documentElement.style.setProperty('--radius', `${s.radius || 16}px`);
  document.body.dataset.gradient = s.gradient || 'aurora';
  document.body.classList.toggle('no-anim', s.animations === false);
  document.body.classList.toggle('compact', s.density === 'compact');
}

function syncUI() {
  if (!settings) return;

  $$('#accentSwatches [data-accent]').forEach((el) => {
    el.classList.toggle('active', el.dataset.accent.toLowerCase() === String(settings.accent).toLowerCase());
  });
  const custom = $('#accentCustom');
  if (custom) custom.value = settings.accent || '#4f7cff';

  const radius = $('#radiusRange');
  const value = Number(settings.radius) || 16;
  radius.value = value;
  radius.style.setProperty('--fill', fillPercent(value));
  $('#radiusVal').textContent = `${value} px`;

  $$('#gradientsGrid [data-gradient]').forEach((el) => {
    el.classList.toggle('active', el.dataset.gradient === settings.gradient);
  });
  $$('#densityGroup button').forEach((el) => {
    el.classList.toggle('active', el.dataset.density === settings.density);
  });

  $('#engineSelect').value = settings.searchEngine || 'google';
  if (document.activeElement !== $('#nameInput')) $('#nameInput').value = settings.name || '';

  $('#tgAnimations').checked = !!settings.animations;
  $('#tgClock').checked = !!settings.showClock;
  $('#tgBookmarks').checked = !!settings.bookmarksBar;
  $('#tgSleep').checked = settings.sleepTabs !== false;
  $('#tgSession').checked = settings.restoreSession !== false;
  $('#tgMemorySaver').checked = settings.memorySaver !== false;
  $('#tgAdblock').checked = settings.adblock !== false;
}

function fillPercent(value) {
  return `${((Number(value) - 6) / 20) * 100}%`;
}

function markSaving() {
  const el = $('#saveState');
  if (!el) return;
  el.classList.add('saving');
  const label = el.querySelector('span:last-child');
  if (label) label.textContent = 'Сохранение…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    el.classList.remove('saving');
    if (label) label.textContent = 'Все изменения сохранены';
  }, 650);
}

/* ------------------------------------------------------------------ quick links */

function renderLinks() {
  const grid = $('#linksGrid');
  const tiles = quickLinks.map((link, index) => {
    const letter = letterOf(link.name || hostOf(link.url));
    const src = faviconFor(link.url);
    return `
      <div class="quick-tile">
        <span class="qt-icon">
          ${src
            ? `<img src="${esc(src)}" alt="" data-letter="${esc(letter)}" draggable="false">`
            : `<span>${esc(letter)}</span>`}
        </span>
        <div class="qt-main">
          <div class="qt-name">${esc(link.name || hostOf(link.url))}</div>
          <div class="qt-host">${esc(hostOf(link.url) || link.url)}</div>
        </div>
        <div class="qt-actions">
          <button class="qt-action" data-edit="${index}" title="Изменить">${'<svg><use href="#i-edit"/></svg>'}</button>
          <button class="qt-action remove" data-remove="${index}" title="Удалить">${'<svg><use href="#i-trash"/></svg>'}</button>
        </div>
      </div>`;
  }).join('');

  grid.innerHTML = tiles + `
    <button class="quick-tile add" id="gridAdd">
      <span class="qt-icon"><svg><use href="#i-plus"/></svg></span>
      <span>Добавить сайт</span>
    </button>`;
}

function persistLinks(message) {
  settings.quickLinks = quickLinks.slice();
  window.aurora.setLinks(quickLinks).then((next) => {
    if (next) {
      settings = next;
      quickLinks = Array.isArray(next.quickLinks) ? next.quickLinks.slice() : quickLinks;
    }
    renderLinks();
    if (message) toast(message);
  }).catch(() => renderLinks());
}

function openLinkModal(index) {
  linkIndex = index;
  const link = index >= 0 ? quickLinks[index] : null;
  $('#linkModalTitle').textContent = link ? 'Изменить сайт' : 'Добавить сайт';
  $('#linkNameInput').value = link?.name || '';
  $('#linkUrlInput').value = link?.url || '';
  $('#linkModal').hidden = false;
  setTimeout(() => (link ? $('#linkUrlInput') : $('#linkNameInput')).focus(), 40);
}

function closeLinkModal() {
  $('#linkModal').hidden = true;
  linkIndex = -1;
}

function saveLink() {
  const name = $('#linkNameInput').value.trim();
  let url = $('#linkUrlInput').value.trim();
  if (!url) {
    $('#linkUrlInput').focus();
    return;
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = 'https://' + url.replace(/^\/+/, '');
  const finalName = name || hostOf(url) || url;

  if (linkIndex >= 0) quickLinks[linkIndex] = { name: finalName, url };
  else quickLinks.push({ name: finalName, url });

  const wasEdit = linkIndex >= 0;
  closeLinkModal();
  persistLinks(wasEdit ? 'Ссылка обновлена' : 'Ссылка добавлена');
}

/* ------------------------------------------------------------------ memory */

async function refreshMemory() {
  const data = await window.aurora.memoryStats().catch(() => null);
  if (!data) return;
  $('#memValue').textContent = data.totalMB.toLocaleString('ru-RU');
  $('#memProcesses').textContent = `${data.processes} ${plural(data.processes, 'процесс', 'процесса', 'процессов')}`;
  const percent = Math.max(5, Math.min(100, Math.round((data.totalMB / 1200) * 100)));
  $('#memBar').style.width = `${percent}%`;
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/* ------------------------------------------------------------------ about */

function updateAbout() {
  const version = info.version || '1.0.0';
  $('#sideVersion').textContent = version;
  $('#aboutVersion').textContent = version;
  $('#aboutChromium').textContent = info.chromium || '—';
  $('#aboutElectron').textContent = info.electron || '—';
  const platform = info.platform === 'linux' ? 'Linux' : (info.platform || 'Linux');
  const arch = navigator.userAgent.includes('x86_64') || navigator.userAgent.includes('x64') ? 'x64' : '';
  $('#aboutPlatform').textContent = [platform, arch].filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------ search */

function filterSettings(query) {
  const q = String(query || '').trim().toLowerCase();
  let any = false;
  const sections = $$('.section');

  for (const section of sections) {
    let visible = 0;
    const items = $$('[data-search]', section);
    for (const item of items) {
      const haystack = `${item.dataset.search || ''} ${item.textContent || ''}`.toLowerCase();
      const show = !q || haystack.includes(q);
      item.hidden = !show;
      if (show) visible++;
    }

    for (const card of $$('.card', section)) {
      if (card.dataset.search) continue;
      const rows = $$('[data-search]', card);
      if (!rows.length) continue;
      card.hidden = q && !rows.some((row) => !row.hidden);
    }

    if (q && visible === 0) section.hidden = true;
    else section.hidden = false;
    if (!section.hidden) any = true;
  }

  $('#noResults').hidden = !q || any;
}

/* ------------------------------------------------------------------ scroll spy */

function observeSections() {
  const content = $('#content');
  const sections = $$('.section');
  const navItems = $$('.nav-item');
  let frame = null;

  const update = () => {
    frame = null;
    const top = content.getBoundingClientRect().top + 130;
    let current = sections[0];
    for (const section of sections) {
      if (section.hidden) continue;
      if (section.getBoundingClientRect().top <= top) current = section;
    }
    navItems.forEach((item) => {
      item.classList.toggle('active', item.dataset.section === current?.id);
    });
  };

  content.addEventListener('scroll', () => {
    if (frame) return;
    frame = requestAnimationFrame(update);
  }, { passive: true });
  update();
}

/* ------------------------------------------------------------------ modal / toast */

function confirmAction(title, description, action) {
  confirming = action;
  $('#confirmTitle').textContent = title;
  $('#confirmDesc').textContent = description;
  $('#confirmModal').hidden = false;
}

function closeConfirm() {
  $('#confirmModal').hidden = true;
  confirming = null;
}

function toast(message) {
  const node = $('#toast');
  node.innerHTML = `<svg><use href="#i-check"/></svg><span>${esc(message)}</span>`;
  node.hidden = false;
  node.style.animation = 'none';
  void node.offsetWidth;
  node.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 2600);
}
