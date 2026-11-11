'use strict';

/* ------------------------------------------------------------------ helpers */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ACCENTS = ['#4f7cff', '#7c5cff', '#e0529c', '#f2603c', '#f0a33c', '#3aa675', '#2fa8c9', '#6b7280'];
const BACKGROUNDS = [
  { id: 'aurora', name: 'Аврора', url: 'backgrounds/aurora.jpg' },
  { id: 'forest', name: 'Лес', url: 'backgrounds/forest.jpg' },
  { id: 'mountain', name: 'Горы', url: 'backgrounds/mountain.jpg' },
  { id: 'night', name: 'Ночь', url: 'backgrounds/night.jpg' },
];
const ENGINES = {
  google: 'Google',
  ddg: 'DuckDuckGo',
  bing: 'Bing',
  yandex: 'Яндекс',
  brave: 'Brave',
};
const ENGINE_LOGOS = {
  google: 'google.png',
  ddg: 'ddg.png',
  bing: 'bing.svg',
  yandex: 'yandex.png',
  brave: 'brave.png',
};
const engineLogo = (id, className = '') => {
  const asset = ENGINE_LOGOS[id];
  return asset ? `<img class="${className}" src="aurora://start/search-engines/${asset}" alt="" draggable="false" decoding="async">` : '';
};

let settings = null;
let engineNames = ENGINES;
let quickLinks = [];
let editingMode = false;
let dialogIndex = -1;
let clockTimer = null;
let memoryTimer = null;
let memoryPulseTimer = null;
let memoryPending = false;

let suggestOpen = false;
let suggestRows = [];
let suggestIndex = 0;
let suggestTimer = null;
let suggestSeq = 0;
let welcomeDraft = {};

/* ------------------------------------------------------------------ boot */

init();

function init() {
  settings = {
    accent: '#4f7cff', backgroundId: 'aurora', name: '', searchEngine: 'google',
    showClock: true, animations: true, onboardingComplete: true,
    quickLinks: [
      { name: 'YouTube', url: 'https://www.youtube.com' },
      { name: 'GitHub', url: 'https://github.com' },
      { name: 'Gmail', url: 'https://mail.google.com' },
      { name: 'Wikipedia', url: 'https://ru.wikipedia.org' },
    ],
  };
  engineNames = ENGINES;
  quickLinks = settings.quickLinks.slice();
  applySettings(settings);
  buildAppearance();
  renderGrid();
  startClock();
  startMemoryMonitor();
  bind();
  getInitial().then((data) => {
    settings = data.settings;
    if (!BACKGROUNDS.some(bg => bg.id === settings.backgroundId)) {
      settings.backgroundId = BACKGROUNDS[0].id;
      window.aurora?.updateSettings({ backgroundId: settings.backgroundId });
    }
    engineNames = data.engines || ENGINES;
    quickLinks = Array.isArray(settings.quickLinks) ? settings.quickLinks.slice() : [];
    applySettings(settings);
    buildAppearance();
    renderGrid();
    initWelcome();
  }).catch(() => {
    settings.onboardingComplete = true;
  });

  if (window.aurora?.onSettings) {
    window.aurora.onSettings((next) => {
      settings = next;
      quickLinks = Array.isArray(next.quickLinks) ? next.quickLinks.slice() : quickLinks;
      applySettings(next);
      renderGrid();
      buildAppearance();
      if (next.onboardingComplete) {
        const dialog = $('#welcome');
        dialog.classList.remove('visible');
        dialog.hidden = true;
      }
    });
  }
}

function initWelcome() {
  if (settings.onboardingComplete) return;
  welcomeDraft = {
    name: settings.name || '',
    searchEngine: settings.searchEngine || 'google',
    accent: settings.accent || '#4f7cff',
    backgroundId: settings.backgroundId || 'aurora',
  };
  $('#welcomeName').value = welcomeDraft.name;
  $('#welcomeEngines').innerHTML = Object.entries(engineNames).map(([id, label]) => `
    <button class="welcome-engine ${id === welcomeDraft.searchEngine ? 'selected' : ''}" type="button" data-welcome-engine="${esc(id)}" aria-pressed="${id === welcomeDraft.searchEngine}">
      <span class="welcome-engine-logo">${engineLogo(id)}</span><span class="welcome-engine-name">${esc(label)}</span><span class="welcome-engine-check" aria-hidden="true"><svg><use href="#i-check"/></svg></span>
    </button>`).join('');
  const dialog = $('#welcome');
  dialog.hidden = false;
  requestAnimationFrame(() => dialog.classList.add('visible'));
  requestAnimationFrame(() => $('#welcomeName').focus());
}

function advanceWelcome() {
  welcomeDraft.name = $('#welcomeName').value.trim();
  updateSettings({
    name: welcomeDraft.name,
    searchEngine: welcomeDraft.searchEngine,
    accent: welcomeDraft.accent,
    backgroundId: welcomeDraft.backgroundId,
    onboardingComplete: true,
  });
  closeWelcome();
  $('#q').focus();
}

function skipWelcome() {
  updateSettings({ onboardingComplete: true });
  closeWelcome();
}

function closeWelcome() {
  const dialog = $('#welcome');
  dialog.classList.remove('visible');
  setTimeout(() => { dialog.hidden = true; }, 300);
}

async function getInitial() {
  if (window.aurora) return window.aurora.getSettings();
  return {
    settings: {
      accent: '#4f7cff', backgroundId: 'aurora', name: '', searchEngine: 'google',
      showClock: true, animations: true,
      quickLinks: [
        { name: 'YouTube', url: 'https://www.youtube.com' },
        { name: 'GitHub', url: 'https://github.com' },
        { name: 'Gmail', url: 'https://mail.google.com' },
        { name: 'Wikipedia', url: 'https://ru.wikipedia.org' },
      ],
    },
    engines: ENGINES,
  };
}

/* ------------------------------------------------------------------ settings */

function applySettings(s) {
  document.documentElement.style.setProperty('--accent', s.accent);
  document.documentElement.style.setProperty('--accent-soft', `color-mix(in srgb, ${s.accent} 12%, transparent)`);
  const bg = BACKGROUNDS.find(b => b.id === s.backgroundId) || BACKGROUNDS[0];
  document.body.style.backgroundImage = `url('${bg.url}')`;
  document.body.style.backgroundSize = 'cover';
  document.body.style.backgroundPosition = 'center';
  document.body.style.backgroundAttachment = 'fixed';
  document.body.classList.toggle('no-anim', !s.animations);
  $('#footEngine').textContent = engineNames[s.searchEngine] || 'Google';
  $('#q').placeholder = `Поиск в ${engineNames[s.searchEngine] || 'Google'} или адрес сайта`;
  renderEnginePicker();
  $('#clock').style.display = s.showClock ? '' : 'none';
  updateGreeting();
}

function updateGreeting() {
  const name = (settings?.name || '').trim();
  const hour = new Date().getHours();
  let greeting = 'Доброй ночи';
  if (hour >= 5 && hour < 12) greeting = 'Доброе утро';
  else if (hour >= 12 && hour < 18) greeting = 'Добрый день';
  else if (hour >= 18 && hour < 23) greeting = 'Добрый вечер';
  $('#greeting').textContent = name ? `${greeting}, ${name}` : greeting;
}

function updateSettings(patch) {
  settings = Object.assign({}, settings, patch);
  applySettings(settings);
  if (window.aurora) window.aurora.updateSettings(patch);
}

/* ------------------------------------------------------------------ clock */

function startClock() {
  const tick = () => {
    const now = new Date();
    $('#clockTime').textContent = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const weekday = now.toLocaleDateString('ru-RU', { weekday: 'long' });
    const dayMonth = now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    const label = `${weekday}, ${dayMonth}`;
    $('#clockDate').textContent = label.charAt(0).toUpperCase() + label.slice(1);

    const short = `${now.getDate()} ${now.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '')} ${now.getFullYear()}`;
    $('#footDate').textContent = short;
    updateGreeting();
    clockTimer = setTimeout(tick, 1000 - Date.now() % 1000);
  };
  tick();
}

function startMemoryMonitor() {
  if (!window.aurora?.memoryStats) {
    $('#memory').hidden = true;
    return;
  }

  const refresh = async () => {
    if (memoryPending) return;
    memoryPending = true;
    try {
      const data = await window.aurora.memoryStats();
      if (!Number.isFinite(data?.totalMB)) throw new Error('Memory stats unavailable');
      $('#memoryValue').innerHTML = `${Math.max(0, data.totalMB).toLocaleString('ru-RU')} <small>МБ</small>`;
      $('#memoryDetail').textContent = `${data.processes} ${processWord(data.processes)} · PSS`;
      $('#memory').classList.add('has-data', 'updated');
      clearTimeout(memoryPulseTimer);
      memoryPulseTimer = setTimeout(() => $('#memory').classList.remove('updated'), 650);
    } catch {
      if (!$('#memory').classList.contains('has-data')) $('#memoryDetail').textContent = 'Данные недоступны';
    } finally {
      memoryPending = false;
    }
  };

  refresh();
  memoryTimer = setInterval(refresh, 5000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
}

function processWord(count) {
  const n = Math.abs(count) % 100;
  if (n >= 11 && n <= 14) return 'процессов';
  const digit = n % 10;
  return digit === 1 ? 'процесс' : digit >= 2 && digit <= 4 ? 'процесса' : 'процессов';
}

/* ------------------------------------------------------------------ quick links */

function renderGrid() {
  const grid = $('#grid');
  const tiles = quickLinks.map((link, index) => {
    const letter = (link.name || link.url || '?').trim().charAt(0).toUpperCase();
    return `
      <button class="link-tile" data-index="${index}" title="${esc(link.name)}">
        <span class="tile-icon">
          <span class="tile-letter">${esc(letter)}</span>
        </span>
        <span class="tile-name">${esc(link.name)}</span>
        <span class="tile-remove" data-remove="${index}" title="Удалить">${'<svg><use href="#i-x"/></svg>'}</span>
      </button>`;
  }).join('');

  const add = editingMode
    ? `<button class="link-tile tile-add" id="addTile"><svg><use href="#i-plus"/></svg><span>Добавить сайт</span></button>`
    : `<button class="link-tile tile-add" id="addTile" hidden><svg><use href="#i-plus"/></svg><span>Добавить сайт</span></button>`;

  grid.innerHTML = tiles + add;
  grid.classList.toggle('editing', editingMode);

  grid.querySelectorAll('.tile-remove').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const idx = parseInt(btn.dataset.remove);
      quickLinks.splice(idx, 1);
      if (quickLinks.length === 0) {
        editingMode = false;
        renderGrid();
      } else {
        renderGrid();
      }
      persistLinks();
    });
  });

  $$('.link-tile').forEach((tile) => {
    tile.addEventListener('click', (e) => {
      if (e.target !== tile && !e.target.closest('.tile-remove')) return;
      if (editingMode || tile.id === 'addTile') return;
      const idx = parseInt(tile.dataset.index);
      if (typeof idx === 'number' && quickLinks[idx]?.url) {
        window.aurora?.open(quickLinks[idx].url, false);
      }
    });
  });

  $('#addTile')?.addEventListener('click', openDialog);
}

function persistLinks() {
  updateSettings({ quickLinks: quickLinks });
}

function renderEnginePicker() {
  const engine = settings?.searchEngine || 'google';
  const logo = $('#enginePickerLogo');
  const name = $('#enginePickerName');
  if (!logo || !name) return;
  logo.innerHTML = engineLogo(engine);
  name.textContent = engineNames[engine] || ENGINES[engine] || 'Google';
  const picker = $('#enginePicker');
  picker.setAttribute('aria-label', `Поисковая система: ${name.textContent}`);
  renderEngineMenu();
}

function renderEngineMenu() {
  const selected = settings?.searchEngine || 'google';
  $('#engineMenu').innerHTML = Object.entries(engineNames).map(([id, label]) => `
    <button type="button" class="engine-option ${id === selected ? 'selected' : ''}"
            role="option" data-engine="${esc(id)}" aria-selected="${id === selected}">
      <span class="engine-option-logo">${engineLogo(id)}</span>
      <span>${esc(label)}</span>
      <svg class="engine-option-check" aria-hidden="true"><use href="#i-check"/></svg>
    </button>`).join('');
}

function toggleEngineMenu(force) {
  const menu = $('#engineMenu');
  const picker = $('#enginePicker');
  const open = force === undefined ? menu.hidden : force;
  menu.hidden = !open;
  picker.classList.toggle('open', open);
  picker.setAttribute('aria-expanded', String(open));
}

function buildAppearance() {
  const accents = ACCENTS.map((color) => `
    <button class="swatch" data-accent="${color}" style="background:${color}" title="${color}" aria-label="${color} ${settings.accent === color ? '(выбран)' : ''}" aria-pressed="${settings.accent === color}"></button>
  `).join('');
  $('#popAccents').innerHTML = accents;

  const backgrounds = BACKGROUNDS.map((bg) => `
    <button class="bg-option" data-bg="${bg.id}" title="${bg.name}" aria-label="${bg.name} ${settings.backgroundId === bg.id ? '(выбран)' : ''}" aria-pressed="${settings.backgroundId === bg.id}">
      <span class="bg-preview" style="background-image:url('${bg.url}')"></span>
      <span class="bg-name">${bg.name}</span>
    </button>
  `).join('');
  $('#popBackgrounds').innerHTML = backgrounds;
}

function toggleAppearance(force) {
  const pop = $('#appearance');
  if (force === false) pop.hidden = true;
  else if (force === true) pop.hidden = false;
  else pop.hidden = !pop.hidden;
}

function chooseEngine(id) {
  if (!Object.prototype.hasOwnProperty.call(engineNames, id)) return;
  if (!$('#welcome').hidden) welcomeDraft.searchEngine = id;
  updateSettings({ searchEngine: id });
  toggleEngineMenu(false);
  toggleAppearance(false);
  $('#q').focus();
}

/* ------------------------------------------------------------------ search */

function closeStartSuggestions() {
  suggestOpen = false;
  suggestRows = [];
  suggestIndex = 0;
  clearTimeout(suggestTimer);
  $('#startSuggest').hidden = true;
  $('#startSuggestList').innerHTML = '';
}

/* ------------------------------------------------------------------ events */

function bind() {
  $('#editLinks').addEventListener('click', () => {
    editingMode = !editingMode;
    renderGrid();
  });

  $('#q').addEventListener('input', (e) => {
    if (!window.aurora) return;
    const value = e.currentTarget.value.trim();
    if (!value) {
      closeStartSuggestions();
      return;
    }
    suggestSeq++;
    const seq = suggestSeq;
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(async () => {
      if (seq !== suggestSeq) return;
      try {
        const suggestions = await window.aurora.suggest(value);
        if (seq !== suggestSeq) return;
        suggestRows = suggestions || [];
        suggestIndex = 0;
        renderStartSuggestions();
      } catch {}
    }, 120);
  });

  $('#searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const value = $('#q').value.trim();
    if (!value) return;
    closeStartSuggestions();
    $('#q').blur();
    if (suggestRows.length > 0 && suggestIndex >= 0 && suggestIndex < suggestRows.length) {
      const row = suggestRows[suggestIndex];
      if (row.search) {
        if (window.aurora) window.aurora.search(value);
        else window.location.href = `https://www.google.com/search?q=${encodeURIComponent(value)}`;
      } else if (window.aurora) {
        window.aurora.open(row.url || value, false);
      } else {
        window.location.href = value;
      }
    } else {
      if (window.aurora) window.aurora.search(value);
      else window.location.href = `https://www.google.com/search?q=${encodeURIComponent(value)}`;
    }
  });

  $('#enginePicker').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleEngineMenu();
  });
  $('#engineMenu').addEventListener('click', (e) => {
    const option = e.target.closest('[data-engine]');
    if (option) chooseEngine(option.dataset.engine);
  });

  $('#q').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeStartSuggestions();
      return;
    }
    if (!suggestOpen || suggestRows.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      suggestIndex = (suggestIndex + 1) % (suggestRows.length + 1);
      updateSuggestHighlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      suggestIndex = (suggestIndex - 1 + suggestRows.length + 1) % (suggestRows.length + 1);
      updateSuggestHighlight();
    }
  });

  $('#appearanceBtn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleAppearance();
  });
  if ($('#settingsBtn')) {
    $('#settingsBtn').addEventListener('click', () => {
      if (window.aurora?.openSettings) window.aurora.openSettings();
    });
  }
  $('#welcomeNext').addEventListener('click', advanceWelcome);
  $('#welcomeSkip').addEventListener('click', skipWelcome);
  $('#welcomeName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') advanceWelcome();
  });
  $('#welcomeEngines').addEventListener('click', (e) => {
    const button = e.target.closest('[data-welcome-engine]');
    if (!button) return;
    welcomeDraft.searchEngine = button.dataset.welcomeEngine;
    $$('#welcomeEngines .welcome-engine').forEach((item) => {
      const selected = item === button;
      item.classList.toggle('selected', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
  });
  $('#popClose').addEventListener('click', () => toggleAppearance(false));
  $('#appearance').addEventListener('click', (e) => {
    const accent = e.target.closest('[data-accent]');
    if (accent) {
      updateSettings({ accent: accent.dataset.accent });
      buildAppearance();
      return;
    }
    const bg = e.target.closest('[data-bg]');
    if (bg) {
      updateSettings({ backgroundId: bg.dataset.bg });
      buildAppearance();
    }
  });

  $('#popMore').addEventListener('click', () => {
    toggleAppearance(false);
    if (window.aurora?.openSettings) window.aurora.openSettings();
  });

  document.addEventListener('click', (e) => {
    if (!$('#appearance').hidden && !e.target.closest('#appearance, #appearanceBtn')) {
      toggleAppearance(false);
    }
    if (!$('#engineMenu').hidden && !e.target.closest('#engineMenu, #enginePicker')) {
      toggleEngineMenu(false);
    }
  });

  $('#dlgCancel').addEventListener('click', closeDialog);
  $('#dlgSave').addEventListener('click', saveDialog);
  $('#dialogBackdrop').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeDialog();
  });
  $$('#dlgName, #dlgUrl').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveDialog();
      if (e.key === 'Escape') closeDialog();
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#dialogBackdrop').hidden) { closeDialog(); return; }
      if (!$('#appearance').hidden) { toggleAppearance(false); return; }
      if (!$('#engineMenu').hidden) { toggleEngineMenu(false); return; }
      if (editingMode) { editingMode = false; renderGrid(); }
    }
    if (e.key === '/' && document.activeElement !== $('#q') && !editingMode) {
      e.preventDefault();
      $('#q').focus();
    }
  });

  window.addEventListener('beforeunload', () => {
    clearTimeout(clockTimer);
    clearInterval(memoryTimer);
    clearTimeout(memoryPulseTimer);
  });
}

function renderStartSuggestions() {
  const list = $('#startSuggestList');
  suggestOpen = suggestRows.length > 0;
  if (!suggestOpen) {
    closeStartSuggestions();
    return;
  }
  list.innerHTML = suggestRows.map((row, idx) => `
    <div class="suggest-item" data-index="${idx}" role="option" aria-selected="${idx === suggestIndex}">
      <div class="suggest-icon"><svg><use href="#i-${row.search ? 'search' : 'globe'}"/></svg></div>
      <div class="suggest-text">
        <div class="suggest-title">${esc(row.title)}</div>
        <div class="suggest-url">${esc(row.host || row.url)}</div>
      </div>
    </div>
  `).join('');
  $('#startSuggest').hidden = false;
  updateSuggestHighlight();
}

function updateSuggestHighlight() {
  $$('.suggest-item').forEach((item, idx) => {
    const selected = idx === suggestIndex;
    item.setAttribute('aria-selected', String(selected));
    item.classList.toggle('selected', selected);
  });
}

/* ------------------------------------------------------------------ dialog */

function openDialog() {
  dialogIndex = -1;
  $('#dlgTitle').textContent = 'Добавить сайт';
  $('#dlgName').value = '';
  $('#dlgUrl').value = '';
  $('#dialogBackdrop').hidden = false;
  $('#dlgName').focus();
}

function closeDialog() {
  dialogIndex = -1;
  $('#dlgName').value = '';
  $('#dlgUrl').value = '';
  $('#dialogBackdrop').hidden = true;
}

function saveDialog() {
  const name = $('#dlgName').value.trim();
  const url = $('#dlgUrl').value.trim();
  if (!name || !url) return;
  let link = url;
  try {
    const resolved = new URL(url);
    link = resolved.toString();
  } catch {
    if (!url.match(/^[a-z][a-z0-9+.-]*:\/\//i)) {
      link = 'https://' + url;
    }
  }
  if (dialogIndex >= 0) {
    quickLinks[dialogIndex].name = name;
    quickLinks[dialogIndex].url = link;
  } else {
    quickLinks.push({ name, url: link });
  }
  closeDialog();
  renderGrid();
  persistLinks();
}
