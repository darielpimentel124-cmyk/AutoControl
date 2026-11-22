/* AutoControl Pro — lógica de la aplicación (sin dependencias) */
(() => {
  'use strict';

  /* =========================================================
     1. Constantes
     ========================================================= */
  const APP_ID = 'AutoControlPro';
  const SCHEMA = 1;
  const APP_VERSION = '1.0.0';
  const MAX_VEHICLES = 10;
  const MAX_SERVICES = 30;
  const MAX_HISTORY = 500;
  const MAX_ODO = 9999999;
  const MAX_RECEIPT_BYTES = 6 * 1024 * 1024;     // 6 MB por recibo
  const MAX_IMPORT_BYTES = 60 * 1024 * 1024;     // 60 MB por respaldo
  const LS_KEY = 'autocontrol_state_v1';
  const LS_LIGHT_KEY = 'autocontrol_state_light_v1';

  // 9 servicios predeterminados (millas / meses, lo que ocurra primero)
  const DEFAULT_SERVICES = [
    { key: 'oil',        name: 'Aceite y filtro',          icon: '🛢️', miles: 5000,  months: 6 },
    { key: 'rotation',   name: 'Rotación de llantas',      icon: '🔄', miles: 7500,  months: 6 },
    { key: 'airfilter',  name: 'Filtro de aire del motor', icon: '🌬️', miles: 15000, months: 12 },
    { key: 'cabin',      name: 'Filtro de cabina',         icon: '❄️', miles: 15000, months: 12 },
    { key: 'brakepads',  name: 'Pastillas de freno',       icon: '🛑', miles: 25000, months: 24 },
    { key: 'brakefluid', name: 'Líquido de frenos',        icon: '💧', miles: 30000, months: 24 },
    { key: 'trans',      name: 'Líquido de transmisión',   icon: '⚙️', miles: 60000, months: 48 },
    { key: 'coolant',    name: 'Refrigerante',             icon: '🌡️', miles: 60000, months: 60 },
    { key: 'plugs',      name: 'Bujías',                   icon: '⚡', miles: 60000, months: 72 },
  ];
  const DEFAULT_BY_KEY = Object.fromEntries(DEFAULT_SERVICES.map(d => [d.key, d]));
  const SERVICE_ICONS = ['🔧', '🛢️', '🔄', '🌬️', '❄️', '🛑', '💧', '⚙️', '🌡️', '⚡', '🔋', '🧽', '💡', '🧰', '🚗', '🛞'];

  const STATUS = {
    due:  { label: 'Vencido',      rank: 3 },
    soon: { label: 'Próximo',      rank: 2 },
    ok:   { label: 'Al día',       rank: 1 },
    none: { label: 'Sin registro', rank: 0 },
  };
  const TITLES = { odo: 'Odómetro', svc: 'Servicios', veh: 'Vehículo', alerts: 'Avisos y Copia' };

  /* =========================================================
     2. Utilidades
     ========================================================= */
  const $ = sel => document.querySelector(sel);
  const nf = new Intl.NumberFormat('en-US');
  const cf = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const df = new Intl.DateTimeFormat('es-US', { day: 'numeric', month: 'short', year: 'numeric' });
  const mf = new Intl.DateTimeFormat('es-US', { month: 'long', year: 'numeric' });
  const fmt = n => nf.format(Math.round(n || 0));
  const money = n => (n == null ? '' : cf.format(n));
  const pad = n => String(n).padStart(2, '0');
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // Crea elementos de forma segura (los datos del usuario siempre van como texto, nunca como HTML)
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    let value;
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'value') value = v;
        else if (k === 'checked') el.checked = !!v;
        else if (k === 'selected') el.selected = !!v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    if (value !== undefined) el.value = value;
    return el;
  }

  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const fmtDate = s => (s ? df.format(parseDate(s)) : '—');
  const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const startOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); };
  const monthKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

  function validDateStr(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const [y, m, d] = v.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d || y < 1900 || y > 2200) return null;
    return v;
  }
  function addMonths(date, months) {
    const d = new Date(date);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + months);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return d;
  }
  function fmtDays(n) {
    if (n < 45) return n === 1 ? '1 día' : `${n} días`;
    const m = Math.round(n / 30.44);
    return m === 1 ? '1 mes' : `${m} meses`;
  }
  function relUpdated(ts) {
    if (!ts) return 'Sin actualizar';
    const d = new Date(ts); d.setHours(0, 0, 0, 0);
    const days = Math.round((startOfToday() - d) / 864e5);
    if (days <= 0) return 'Actualizado hoy';
    if (days === 1) return 'Actualizado ayer';
    return `Actualizado hace ${fmtDays(days)}`;
  }
  const parseIntInput = s => {
    const d = String(s ?? '').replace(/[^\d]/g, '');
    return d === '' ? null : Math.min(parseInt(d, 10), MAX_ODO);
  };
  function parseMoney(s) {
    let t = String(s ?? '').replace(/[^\d.,]/g, '');
    if (t === '') return null;
    if (t.includes('.') && t.includes(',')) t = t.replace(/,/g, '');
    else t = t.replace(',', '.');
    const n = parseFloat(t);
    return Number.isFinite(n) && n >= 0 && n < 1e7 ? Math.round(n * 100) / 100 : null;
  }
  const cleanVin = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 17);
  const vibrate = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* sin vibración */ } };

  /* =========================================================
     3. Almacenamiento persistente (IndexedDB + respaldo localStorage)
     ========================================================= */
  const Store = {
    db: null,
    backend: 'localStorage',
    open() {
      return new Promise(resolve => {
        if (!('indexedDB' in window)) return resolve(null);
        let req;
        try { req = indexedDB.open('autocontrol-pro', 1); } catch (e) { return resolve(null); }
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => { this.db = req.result; this.backend = 'IndexedDB'; resolve(this.db); };
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      });
    },
    async get() {
      if (this.db) {
        try {
          const v = await new Promise((res, rej) => {
            const r = this.db.transaction('kv', 'readonly').objectStore('kv').get('state');
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
          });
          if (v) return v;
        } catch (e) { console.warn('IndexedDB get', e); }
      }
      for (const key of [LS_KEY, LS_LIGHT_KEY]) {
        try { const s = localStorage.getItem(key); if (s) return JSON.parse(s); } catch (e) { /* siguiente */ }
      }
      return null;
    },
    async set(st) {
      let ok = false;
      if (this.db) {
        try {
          await new Promise((res, rej) => {
            const tx = this.db.transaction('kv', 'readwrite');
            tx.objectStore('kv').put(st, 'state');
            tx.oncomplete = res;
            tx.onerror = () => rej(tx.error);
            tx.onabort = () => rej(tx.error);
          });
          ok = true;
        } catch (e) { console.warn('IndexedDB set', e); }
      }
      if (ok) {
        // Copia ligera (sin recibos) por si IndexedDB se pierde
        try { localStorage.setItem(LS_LIGHT_KEY, JSON.stringify(stripReceipts(st))); } catch (e) { /* lleno */ }
        return true;
      }
      try { localStorage.setItem(LS_KEY, JSON.stringify(st)); return true; } catch (e) { /* lleno */ }
      try { localStorage.setItem(LS_LIGHT_KEY, JSON.stringify(stripReceipts(st))); } catch (e) { /* lleno */ }
      return false;
    },
  };
  function stripReceipts(st) {
    return { ...st, vehicles: st.vehicles.map(v => ({ ...v, services: v.services.map(s => ({ ...s, receipt: null })) })) };
  }

  /* =========================================================
     4. Estado y modelo
     ========================================================= */
  let state = null;
  let current = 'odo';
  let saveTimer = null;
  let deferredInstall = null;

  const newState = () => ({
    app: APP_ID, schema: SCHEMA, vehicles: [], activeId: null,
    settings: { reminderDay: 1, lastNotified: null, lastBackup: null },
  });
  const emptyDetails = () => ({ product: '', partNumber: '', store: '', price: null, warranty: '', notes: '' });

  function makeService(def) {
    return {
      id: uid(), key: def.key || null, name: def.name, icon: def.icon || '🔧',
      intervalMiles: def.miles || 0, intervalMonths: def.months || 0,
      lastMiles: null, lastDate: null,
      details: emptyDetails(), receipt: null, history: [],
    };
  }
  function makeVehicle(d) {
    return {
      id: uid(), year: d.year || '', make: d.make || '', model: d.model || '', engine: d.engine || '', vin: d.vin || '',
      odometer: d.odometer || 0, odometerUpdatedAt: Date.now(), notifications: true, createdAt: Date.now(),
      services: DEFAULT_SERVICES.map(makeService),
    };
  }
  const activeVehicle = () => (state.vehicles.find(v => v.id === state.activeId) || state.vehicles[0] || null);
  const vName = v => [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehículo sin nombre';
  const shortName = v => {
    const base = v.model || v.make || 'Vehículo';
    return v.year ? `${base} '${String(v.year).slice(-2)}` : base;
  };

  function save(immediate) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, immediate ? 0 : 350);
  }
  async function flushSave() {
    if (saveTimer === null) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    const ok = await Store.set(state);
    flashSaved(ok);
  }
  let savedTimer;
  function flashSaved(ok) {
    const pill = $('#savePill');
    pill.textContent = ok ? '✓' : '!';
    pill.setAttribute('title', ok ? 'Guardado' : 'No se pudo guardar');
    pill.classList.toggle('err', !ok);
    pill.classList.add('show');
    const line = $('#odoSaved');
    if (line && ok) line.classList.add('show');
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => {
      pill.classList.remove('show');
      const l = $('#odoSaved'); if (l) l.classList.remove('show');
    }, 1600);
    if (!ok) toast('No se pudo guardar: el almacenamiento está lleno. Quita recibos grandes.', { ms: 5000 });
  }

  /* ---------- Cálculo de estado (millas o tiempo, lo que ocurra primero) ---------- */
  function svcStatus(v, s) {
    let milesLeft = null, daysLeft = null, dueDate = null;
    if (s.intervalMiles > 0 && s.lastMiles != null) milesLeft = s.lastMiles + s.intervalMiles - v.odometer;
    if (s.intervalMonths > 0 && s.lastDate) {
      dueDate = addMonths(parseDate(s.lastDate), s.intervalMonths);
      daysLeft = Math.round((dueDate - startOfToday()) / 864e5);
    }
    if (milesLeft == null && daysLeft == null) {
      const text = (s.intervalMiles > 0 || s.intervalMonths > 0) ? 'Sin registro · toca ✓ Registrar' : 'Sin intervalo definido';
      return { code: 'none', text, milesLeft, daysLeft };
    }
    const warnMiles = Math.max(500, (s.intervalMiles || 0) * 0.1);
    let code = 'ok';
    if ((milesLeft != null && milesLeft <= 0) || (daysLeft != null && daysLeft <= 0)) code = 'due';
    else if ((milesLeft != null && milesLeft <= warnMiles) || (daysLeft != null && daysLeft <= 30)) code = 'soon';

    let text;
    if (code === 'due') {
      if (milesLeft != null && milesLeft <= 0) text = milesLeft === 0 ? 'Vencido: toca hoy' : `Vencido por ${fmt(-milesLeft)} mi`;
      else text = daysLeft === 0 ? 'Vence hoy' : `Vencido hace ${fmtDays(-daysLeft)}`;
    } else {
      const parts = [];
      if (milesLeft != null) parts.push(`${fmt(milesLeft)} mi`);
      if (daysLeft != null) parts.push(fmtDays(daysLeft));
      text = 'Faltan ' + parts.join(' o ');
    }
    return { code, text, milesLeft, daysLeft, dueDate };
  }
  function vehicleStatus(v) {
    const counts = { due: 0, soon: 0, ok: 0, none: 0 };
    for (const s of v.services) counts[svcStatus(v, s).code]++;
    const code = counts.due ? 'due' : counts.soon ? 'soon' : counts.ok ? 'ok' : 'none';
    return { code, counts };
  }
  function intervalText(s) {
    const a = s.intervalMiles > 0 ? `${fmt(s.intervalMiles)} mi` : null;
    const b = s.intervalMonths > 0 ? (s.intervalMonths === 1 ? '1 mes' : `${s.intervalMonths} meses`) : null;
    if (!a && !b) return 'Sin intervalo';
    return 'Cada ' + [a, b].filter(Boolean).join(' o ');
  }
  function lastText(s) {
    const parts = [];
    if (s.lastDate) parts.push(fmtDate(s.lastDate));
    if (s.lastMiles != null) parts.push(`${fmt(s.lastMiles)} mi`);
    return parts.join(' · ');
  }
  function sortHistory(s) {
    s.history.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.miles || 0) - (a.miles || 0)));
  }
  const pendingVehicles = () => {
    const som = startOfMonth().getTime();
    return state.vehicles.filter(v => v.notifications && (!v.odometerUpdatedAt || v.odometerUpdatedAt < som));
  };
  const reminderActive = () => new Date().getDate() >= state.settings.reminderDay;

  /* =========================================================
     5. Hojas inferiores, diálogos y toast
     ========================================================= */
  const sheetStack = [];
  let closeWaiters = [];

  function openSheet({ title, body, footer, onClose }) {
    const bodyEl = h('div', { class: 'sheet-body' }, body);
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'grabber' }),
      h('div', { class: 'sheet-head' },
        h('h2', { text: title }),
        h('button', { class: 'x', type: 'button', 'aria-label': 'Cerrar', onclick: () => closeTop() }, '✕')),
      bodyEl,
      footer ? h('div', { class: 'sheet-foot' }, footer) : null);
    const overlay = h('div', { class: 'overlay' }, sheet);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeTop(); });
    $('#sheets').append(overlay);
    const entry = { overlay, onClose, closing: false };
    sheetStack.push(entry);
    document.body.classList.add('modal-open');
    try { history.pushState({ acpSheet: sheetStack.length }, ''); } catch (e) { /* sin historial */ }
    return { close: closeTop, body: bodyEl };
  }
  function closeTop() {
    return new Promise(resolve => {
      const top = sheetStack[sheetStack.length - 1];
      if (!top) return resolve();
      closeWaiters.push(resolve);
      if (top.closing) return;
      top.closing = true;
      history.back();
      // Respaldo si el navegador no emite popstate
      setTimeout(() => { if (sheetStack[sheetStack.length - 1] === top) removeTop(); }, 500);
    });
  }
  function removeTop() {
    const e = sheetStack.pop();
    if (!e) return;
    e.overlay.classList.add('closing');
    setTimeout(() => e.overlay.remove(), 220);
    if (!sheetStack.length) document.body.classList.remove('modal-open');
    try { e.onClose && e.onClose(); } catch (err) { console.error(err); }
    if (!sheetStack.length) render();
    const w = closeWaiters; closeWaiters = [];
    w.forEach(f => f());
  }
  window.addEventListener('popstate', () => { if (sheetStack.length) removeTop(); });

  function confirmDialog({ title, message, ok = 'Confirmar', danger = false }) {
    return new Promise(resolve => {
      let result = false;
      const footer = h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: () => sh.close() }, 'Cancelar'),
        h('button', { class: 'btn ' + (danger ? 'danger-solid' : 'primary'), type: 'button', onclick: () => { result = true; sh.close(); } }, ok));
      const sh = openSheet({ title, body: h('p', { class: 'dialog-msg' }, message), footer, onClose: () => resolve(result) });
    });
  }
  function infoDialog(title, message) {
    return new Promise(resolve => {
      const sh = openSheet({
        title, body: h('p', { class: 'dialog-msg' }, message),
        footer: h('button', { class: 'btn primary', type: 'button', onclick: () => sh.close() }, 'Entendido'),
        onClose: resolve,
      });
    });
  }

  let toastTimer;
  function toast(msg, { action, onAction, ms = 2600 } = {}) {
    const t = $('#toast');
    const kids = [h('span', null, msg)];
    if (action) kids.push(h('button', { type: 'button', onclick: () => { hideToast(); onAction(); } }, action));
    t.replaceChildren(...kids);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, ms);
  }
  const hideToast = () => $('#toast').classList.remove('show');

  /* ---------- Componentes de formulario ---------- */
  const field = (label, input, hint) => h('label', { class: 'field' }, h('span', null, label), input, hint || null);
  const secTitle = t => h('div', { class: 'sec-title' }, t);
  function textInput(value, onInput, attrs = {}) {
    return h('input', { class: 'input', type: 'text', autocomplete: 'off', maxlength: 80, ...attrs, value: value ?? '', oninput: e => onInput(e.target.value, e) });
  }
  function numInput(value, onNum, attrs = {}) {
    return h('input', {
      class: 'input', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', maxlength: 9, ...attrs,
      value: value == null ? '' : String(value),
      oninput: e => {
        const clean = e.target.value.replace(/[^\d]/g, '');
        if (clean !== e.target.value) e.target.value = clean;
        onNum(parseIntInput(clean));
      },
    });
  }
  function moneyInput(value, onNum) {
    return h('input', {
      class: 'input', type: 'text', inputmode: 'decimal', autocomplete: 'off', maxlength: 12, placeholder: '$0.00',
      value: value == null ? '' : String(value), oninput: e => onNum(parseMoney(e.target.value)),
    });
  }

  /* =========================================================
     6. Navegación y renderizado
     ========================================================= */
  function go(tab) {
    current = tab;
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 's-' + tab));
    document.querySelectorAll('.tab').forEach(b => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $('#main').scrollTop = 0;
    render();
  }
  function render() {
    renderHeader();
    renderBadges();
    ({ odo: renderOdo, svc: renderSvc, veh: renderVeh, alerts: renderAlerts })[current]();
  }
  function renderHeader() {
    $('#screenTitle').textContent = TITLES[current];
    const b = $('#vehBtn');
    const v = activeVehicle();
    const show = !!v && (current === 'svc' || current === 'veh');
    b.hidden = !show;
    if (show) {
      b.replaceChildren(h('span', { class: 'dot ' + vehicleStatus(v).code }), h('span', { class: 'veh-btn-name' }, shortName(v)), h('span', { class: 'caret' }, '▾'));
    }
  }
  function setBadge(tab, n) {
    const el = document.querySelector(`.tab[data-tab="${tab}"] .badge`);
    el.hidden = !n;
    el.textContent = n > 9 ? '9+' : String(n || '');
  }
  function renderBadges() {
    const v = activeVehicle();
    setBadge('svc', v ? vehicleStatus(v).counts.due : 0);
    const pend = reminderActive() ? pendingVehicles().length : 0;
    setBadge('alerts', pend);
    try {
      if (navigator.setAppBadge) { pend ? navigator.setAppBadge(pend) : navigator.clearAppBadge(); }
    } catch (e) { /* no soportado */ }
  }

  function emptyState() {
    return h('div', { class: 'empty' },
      h('div', { class: 'empty-art' }, '🚗'),
      h('h2', null, 'Añade tu primer vehículo'),
      h('p', { class: 'muted' }, 'Controla el odómetro y cada mantenimiento en un solo lugar.'),
      h('button', { class: 'btn primary lg', type: 'button', onclick: addVehicleSheet }, '+ Añadir vehículo'));
  }

  function vehicleChips() {
    const chips = h('div', { class: 'chips', role: 'tablist', 'aria-label': 'Vehículos' });
    for (const v of state.vehicles) {
      const active = v.id === state.activeId;
      chips.append(h('button', {
        class: 'chip' + (active ? ' active' : ''), type: 'button', role: 'tab', 'aria-selected': active ? 'true' : 'false',
        onclick: () => { state.activeId = v.id; save(); render(); },
      }, h('span', { class: 'dot ' + vehicleStatus(v).code }), shortName(v)));
    }
    if (state.vehicles.length < MAX_VEHICLES) {
      chips.append(h('button', { class: 'chip add', type: 'button', onclick: addVehicleSheet }, '+ Añadir vehículo'));
    } else {
      chips.append(h('span', { class: 'chip limit' }, '🔒 Límite 10/10 alcanzado'));
    }
    return h('div', { class: 'chips-wrap' }, chips,
      h('div', { class: 'chips-count' }, `${state.vehicles.length}/${MAX_VEHICLES} vehículos`));
  }

  function reminderBanner() {
    if (!reminderActive()) return null;
    const pend = pendingVehicles();
    if (!pend.length) return null;
    const names = pend.map(vName);
    return h('button', { class: 'banner', type: 'button', onclick: () => go('alerts') },
      h('span', { class: 'ico' }, '📅'),
      h('span', null, h('b', null, 'Recordatorio mensual: '), `actualiza el odómetro de ${joinNames(names)}.`));
  }
  function joinNames(names) {
    if (names.length <= 1) return names[0] || '';
    return names.slice(0, -1).join(', ') + ' y ' + names[names.length - 1];
  }

  /* ---------- Pantalla 1: Odómetro ---------- */
  function renderOdo() {
    const root = $('#s-odo');
    root.replaceChildren();
    const v = activeVehicle();
    if (!v) { root.append(emptyState()); return; }
    root.append(vehicleChips());
    const banner = reminderBanner();
    if (banner) root.append(banner);

    root.append(h('div', { class: 'card odo-card' },
      h('div', { class: 'odo-veh' }, vName(v)),
      h('button', { class: 'odo-num', id: 'odoNum', type: 'button', 'aria-label': 'Editar lectura del odómetro', onclick: () => editOdometer(v) }, fmt(v.odometer)),
      h('div', { class: 'odo-unit' }, 'millas · toca el número para editar'),
      h('div', { class: 'quick' }, [100, 500, 1000].map(n =>
        h('button', { class: 'btn', type: 'button', onclick: () => bump(v, n) }, '+' + fmt(n)))),
      h('div', { class: 'saved-line', id: 'odoSaved' }, '✓ Guardado automáticamente'),
      h('div', { class: 'odo-meta', id: 'odoMeta' }, relUpdated(v.odometerUpdatedAt)),
      h('button', {
        class: 'btn ghost odo-confirm', type: 'button',
        onclick: () => { v.odometerUpdatedAt = Date.now(); save(); render(); toast('Lectura confirmada para este mes ✓'); },
      }, '✓ Confirmar lectura sin cambios')));
    root.append(statusCard(v));
    const act = root.querySelector('.chip.active');
    if (act) act.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  function statusCard(v) {
    const st = vehicleStatus(v);
    const c = st.counts;
    const note = st.code === 'none'
      ? h('p', { class: 'muted' }, 'Registra el último servicio de cada mantenimiento para calcular el estado.')
      : (c.none ? h('p', { class: 'muted' }, `${c.none} servicio(s) sin registro.`) : null);
    return h('div', { class: 'card', id: 'odoStatus' },
      h('div', { class: 'status-head' },
        h('div', { class: 'card-title' }, 'Estado general'),
        h('span', { class: 'pill lg ' + st.code }, STATUS[st.code].label)),
      h('div', { class: 'stats' },
        h('div', { class: 'stat due' }, h('b', null, c.due), h('span', null, 'Vencidos')),
        h('div', { class: 'stat soon' }, h('b', null, c.soon), h('span', null, 'Próximos')),
        h('div', { class: 'stat ok' }, h('b', null, c.ok), h('span', null, 'Al día'))),
      note,
      h('button', { class: 'btn', type: 'button', onclick: () => go('svc') }, 'Ver servicios →'));
  }

  let undo = null;
  function bump(v, n) {
    if (!undo || undo.id !== v.id || Date.now() - undo.t > 4000) undo = { id: v.id, base: v.odometer, baseAt: v.odometerUpdatedAt };
    undo.t = Date.now();
    v.odometer = Math.min(v.odometer + n, MAX_ODO);
    v.odometerUpdatedAt = Date.now();
    save();
    vibrate(12);
    const num = $('#odoNum');
    if (num) { num.textContent = fmt(v.odometer); num.classList.remove('pop'); void num.offsetWidth; num.classList.add('pop'); }
    const meta = $('#odoMeta'); if (meta) meta.textContent = relUpdated(v.odometerUpdatedAt);
    const sc = $('#odoStatus'); if (sc) sc.replaceWith(statusCard(v));
    const banner = document.querySelector('#s-odo .banner');
    if (banner) { const nb = reminderBanner(); nb ? banner.replaceWith(nb) : banner.remove(); }
    renderBadges();
    const u = undo;
    toast(`+${fmt(v.odometer - u.base)} mi → ${fmt(v.odometer)} mi`, {
      action: 'Deshacer', ms: 4000,
      onAction: () => { v.odometer = u.base; v.odometerUpdatedAt = u.baseAt; undo = null; save(); render(); },
    });
  }

  function editOdometer(v) {
    let val = v.odometer;
    const input = numInput(val, n => { val = n; }, { class: 'input big', 'aria-label': 'Millas' });
    const saveIt = async () => {
      if (val == null) return toast('Escribe la lectura en millas');
      if (val < v.odometer) {
        await sh.close();
        const ok = await confirmDialog({
          title: '¿Bajar la lectura?',
          message: `La nueva lectura (${fmt(val)} mi) es menor que la actual (${fmt(v.odometer)} mi). ¿Corregirla de todos modos?`,
          ok: 'Sí, corregir',
        });
        if (!ok) return;
      } else {
        await sh.close();
      }
      v.odometer = val; v.odometerUpdatedAt = Date.now(); save(); render();
      toast(`Odómetro: ${fmt(val)} mi ✓`);
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') saveIt(); });
    const sh = openSheet({
      title: 'Lectura del odómetro',
      body: h('div', null, h('p', { class: 'muted' }, vName(v)), field('Millas actuales', input)),
      footer: h('button', { class: 'btn primary lg', type: 'button', onclick: saveIt }, 'Guardar lectura'),
    });
    setTimeout(() => { input.focus(); input.select(); }, 320);
  }

  /* ---------- Añadir / elegir vehículo ---------- */
  function vehicleForm(d) {
    const vinHintEl = h('div', { class: 'hint' });
    const setHint = () => { const r = vinHint(d.vin); vinHintEl.textContent = r.t; vinHintEl.className = 'hint ' + r.c; };
    setHint();
    return [
      h('div', { class: 'row' },
        field('Año', numInput(d.year, n => { d.year = n == null ? '' : String(n).slice(0, 4); }, { maxlength: 4, placeholder: '2020' })),
        field('Marca', textInput(d.make, val => { d.make = val.trim().slice(0, 40); }, { maxlength: 40, placeholder: 'Toyota', autocapitalize: 'words' }))),
      field('Modelo', textInput(d.model, val => { d.model = val.trim().slice(0, 40); }, { maxlength: 40, placeholder: 'Corolla', autocapitalize: 'words' })),
      field('Motor', textInput(d.engine, val => { d.engine = val.trim().slice(0, 40); }, { maxlength: 40, placeholder: '2.0L 4 cil.' })),
      field('VIN', h('input', {
        class: 'input vin', type: 'text', maxlength: 17, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: '17 caracteres',
        value: d.vin || '',
        oninput: e => { const c = cleanVin(e.target.value); if (c !== e.target.value) e.target.value = c; d.vin = c; setHint(); d.onChange && d.onChange(); },
      }), vinHintEl),
    ];
  }
  function vinHint(vin) {
    if (!vin) return { t: '17 caracteres (opcional)', c: '' };
    if (/[IOQ]/.test(vin)) return { t: 'Revisa: el VIN no usa las letras I, O ni Q', c: 'warn' };
    if (vin.length !== 17) return { t: `${vin.length}/17 caracteres`, c: 'warn' };
    return { t: '✓ VIN de 17 caracteres', c: 'good' };
  }

  function addVehicleSheet() {
    if (state.vehicles.length >= MAX_VEHICLES) return toast('Límite alcanzado: 10/10 vehículos');
    const d = { year: '', make: '', model: '', engine: '', vin: '', odometer: null };
    const body = h('div', null,
      vehicleForm(d),
      field('Odómetro actual (millas)', numInput(null, n => { d.odometer = n; }, { placeholder: '0' })),
      h('p', { class: 'hint' }, `Se crearán los ${DEFAULT_SERVICES.length} servicios predeterminados. Vehículo ${state.vehicles.length + 1} de ${MAX_VEHICLES}.`));
    const sh = openSheet({
      title: 'Nuevo vehículo', body,
      footer: h('button', {
        class: 'btn primary lg', type: 'button',
        onclick: async () => {
          if (!d.make && !d.model) return toast('Escribe al menos la marca o el modelo');
          const y = Number(d.year);
          if (d.year && (y < 1900 || y > new Date().getFullYear() + 2)) return toast('Revisa el año');
          if (state.vehicles.length >= MAX_VEHICLES) return toast('Límite alcanzado: 10/10 vehículos');
          const v = makeVehicle({ ...d, odometer: d.odometer || 0 });
          state.vehicles.push(v);
          state.activeId = v.id;
          save(true);
          await sh.close();
          go('odo');
          toast(`${vName(v)} añadido ✓`);
        },
      }, 'Añadir vehículo'),
    });
  }

  function vehiclePicker() {
    const list = h('div', { class: 'stack' },
      state.vehicles.map(v => h('button', {
        class: 'btn btn-left' + (v.id === state.activeId ? ' primary' : ''), type: 'button',
        onclick: async () => { state.activeId = v.id; save(); await sh.close(); },
      }, h('span', { class: 'dot ' + vehicleStatus(v).code }), h('span', { class: 'veh-btn-name' }, vName(v)))),
      state.vehicles.length < MAX_VEHICLES
        ? h('button', { class: 'btn ghost', type: 'button', onclick: async () => { await sh.close(); addVehicleSheet(); } }, '+ Añadir vehículo')
        : h('p', { class: 'muted center' }, 'Límite de 10/10 vehículos alcanzado'));
    const sh = openSheet({ title: 'Elegir vehículo', body: list });
  }

  /* ---------- Pantalla 2: Servicios ---------- */
  function renderSvc() {
    const root = $('#s-svc');
    root.replaceChildren();
    const v = activeVehicle();
    if (!v) { root.append(emptyState()); return; }
    root.append(h('div', { class: 'screen-head' },
      h('div', { class: 't' }, vName(v)),
      h('div', { class: 's' }, `${fmt(v.odometer)} mi · por millas o tiempo, lo que ocurra primero`)));

    const list = v.services.map((s, i) => ({ s, i, st: svcStatus(v, s) }));
    list.sort((a, b) => (STATUS[b.st.code].rank - STATUS[a.st.code].rank) || ((a.st.milesLeft ?? 1e9) - (b.st.milesLeft ?? 1e9)) || (a.i - b.i));
    for (const { s, st } of list) {
      const last = lastText(s);
      root.append(h('div', { class: 'card svc ' + st.code },
        h('div', { class: 'svc-head' },
          h('div', { class: 'svc-icon', 'aria-hidden': 'true' }, s.icon),
          h('div', { class: 'svc-name' }, s.name),
          h('span', { class: 'pill ' + st.code }, STATUS[st.code].label)),
        h('div', { class: 'svc-detail ' + st.code }, st.text),
        h('div', { class: 'svc-int' }, intervalText(s) + (last ? ` · Último: ${last}` : '')),
        h('div', { class: 'svc-actions' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => registerSheet(v, s) }, '✓ Registrar'),
          h('button', { class: 'btn eye', type: 'button', 'aria-label': `Ver y editar ${s.name}`, onclick: () => detailSheet(v, s) }, '👁️'))));
    }
    root.append(h('button', {
      class: 'btn ghost lg', type: 'button', disabled: v.services.length >= MAX_SERVICES,
      onclick: () => newServiceSheet(v),
    }, v.services.length >= MAX_SERVICES ? `Máximo ${MAX_SERVICES} servicios` : '+ Nuevo servicio'));
  }

  function registerSheet(v, s, onDone) {
    const d = { date: todayStr(), miles: v.odometer, price: s.details.price, notes: '' };
    const body = h('div', null,
      h('p', { class: 'muted' }, `${s.icon} ${s.name} · ${vName(v)}`),
      field('Fecha', h('input', { class: 'input', type: 'date', max: todayStr(), value: d.date, onchange: e => { d.date = e.target.value; } })),
      field('Millas en el odómetro', numInput(d.miles, n => { d.miles = n; })),
      field('Precio (opcional)', moneyInput(d.price, n => { d.price = n; })),
      field('Notas (opcional)', h('textarea', { class: 'input', maxlength: 500, placeholder: 'Ej. Aceite 0W-20 sintético', oninput: e => { d.notes = e.target.value; } })));
    const sh = openSheet({
      title: 'Registrar mantenimiento', body,
      footer: h('button', {
        class: 'btn primary lg', type: 'button',
        onclick: async () => {
          const date = validDateStr(d.date);
          if (!date) return toast('Elige una fecha válida');
          if (date > todayStr()) return toast('La fecha no puede ser futura');
          if (d.miles == null) return toast('Escribe las millas');
          s.history.push({ id: uid(), date, miles: d.miles, price: d.price, product: s.details.product || '', notes: d.notes.trim().slice(0, 500) });
          sortHistory(s);
          if (s.history.length > MAX_HISTORY) s.history.length = MAX_HISTORY;
          if (!s.lastDate || date > s.lastDate || (date === s.lastDate && d.miles >= (s.lastMiles || 0))) {
            s.lastDate = date; s.lastMiles = d.miles;
          }
          if (d.miles > v.odometer) { v.odometer = d.miles; v.odometerUpdatedAt = Date.now(); }
          save(true);
          await sh.close();
          vibrate(20);
          toast(`✓ ${s.name} registrado`);
          if (onDone) onDone();
        },
      }, '✓ Guardar registro'),
    });
  }

  function detailSheet(v, s) {
    const body = h('div');
    const sh = openSheet({ title: `${s.icon} ${s.name}`, body });
    const statusBox = h('div');
    const receiptWrap = h('div', { class: 'stack' });
    const histWrap = h('div');

    const refreshStatus = () => {
      const st = svcStatus(v, s);
      statusBox.replaceChildren(h('div', { class: 'status-box' },
        h('span', { class: 'pill ' + st.code }, STATUS[st.code].label),
        h('div', { class: 'status-box-text' }, st.text),
        h('div', { class: 'svc-int' }, intervalText(s))));
    };
    const lastDateIn = h('input', {
      class: 'input', type: 'date', max: todayStr(), value: s.lastDate || '',
      onchange: e => { s.lastDate = validDateStr(e.target.value); save(); refreshStatus(); },
    });
    const lastMilesIn = numInput(s.lastMiles, n => { s.lastMiles = n; save(); refreshStatus(); });
    const miIn = numInput(s.intervalMiles || '', n => { s.intervalMiles = n || 0; save(); refreshStatus(); }, { maxlength: 7 });
    const moIn = numInput(s.intervalMonths || '', n => { s.intervalMonths = Math.min(n || 0, 240); save(); refreshStatus(); }, { maxlength: 3 });

    const refreshHist = () => {
      if (!s.history.length) { histWrap.replaceChildren(h('p', { class: 'muted' }, 'Aún no hay registros de este servicio.')); return; }
      histWrap.replaceChildren(...s.history.map(e => h('div', { class: 'hist' },
        h('div', { class: 'hist-main' },
          h('div', { class: 'hist-date' }, fmtDate(e.date)),
          h('div', { class: 'hist-sub' }, [`${fmt(e.miles)} mi`, e.price != null ? money(e.price) : null, e.product || null].filter(Boolean).join(' · ')),
          e.notes ? h('div', { class: 'hist-notes' }, e.notes) : null),
        h('button', {
          class: 'icon-btn', type: 'button', 'aria-label': 'Eliminar registro',
          onclick: async () => {
            const ok = await confirmDialog({ title: 'Eliminar registro', message: `¿Eliminar el registro del ${fmtDate(e.date)} (${fmt(e.miles)} mi)?`, ok: 'Eliminar', danger: true });
            if (!ok) return;
            const wasLast = e.date === s.lastDate && e.miles === s.lastMiles;
            s.history = s.history.filter(x => x !== e);
            if (wasLast) {
              const top = s.history[0];
              s.lastDate = top ? top.date : null; s.lastMiles = top ? top.miles : null;
              lastDateIn.value = s.lastDate || ''; lastMilesIn.value = s.lastMiles == null ? '' : String(s.lastMiles);
            }
            save(); refreshHist(); refreshStatus();
          },
        }, '🗑️'))));
    };

    const factory = s.key ? DEFAULT_BY_KEY[s.key] : null;
    const det = s.details;
    body.append(
      statusBox,
      h('div', { class: 'stack' }, h('button', {
        class: 'btn primary', type: 'button',
        onclick: () => registerSheet(v, s, () => {
          lastDateIn.value = s.lastDate || ''; lastMilesIn.value = s.lastMiles == null ? '' : String(s.lastMiles);
          refreshStatus(); refreshHist();
        }),
      }, '✓ Registrar mantenimiento realizado')),

      secTitle('Último servicio realizado'),
      h('div', { class: 'row' }, field('Fecha', lastDateIn), field('Millas', lastMilesIn)),

      secTitle('Intervalo · lo que ocurra primero'),
      field('Nombre del servicio', textInput(s.name, val => { if (val.trim()) { s.name = val.trim().slice(0, 60); save(); } }, { maxlength: 60 })),
      h('div', { class: 'row' }, field('Cada (millas)', miIn), field('Cada (meses)', moIn)),
      factory ? h('button', {
        class: 'btn ghost', type: 'button',
        onclick: () => {
          s.intervalMiles = factory.miles; s.intervalMonths = factory.months;
          miIn.value = String(factory.miles); moIn.value = String(factory.months);
          save(); refreshStatus(); toast('Intervalo de fábrica restaurado ✓');
        },
      }, `↺ Restaurar de fábrica (${fmt(factory.miles)} mi / ${factory.months} meses)`) : null,

      secTitle('Producto y compra'),
      field('Producto / marca', textInput(det.product, val => { det.product = val.slice(0, 80); save(); }, { placeholder: 'Ej. Mobil 1 0W-20' })),
      h('div', { class: 'row' },
        field('Nº de parte', textInput(det.partNumber, val => { det.partNumber = val.slice(0, 40); save(); }, { maxlength: 40, autocapitalize: 'characters' })),
        field('Precio', moneyInput(det.price, n => { det.price = n; save(); }))),
      field('Tienda', textInput(det.store, val => { det.store = val.slice(0, 80); save(); }, { placeholder: 'Ej. AutoZone' })),
      field('Garantía', textInput(det.warranty, val => { det.warranty = val.slice(0, 80); save(); }, { placeholder: 'Ej. 2 años / 24,000 mi' })),
      field('Notas', h('textarea', { class: 'input', maxlength: 1000, value: det.notes, oninput: e => { det.notes = e.target.value.slice(0, 1000); save(); } })),

      secTitle('Recibo (foto o PDF)'),
      receiptWrap,

      secTitle('Historial'),
      histWrap,

      !s.key ? h('div', { class: 'stack' }, secTitle('Zona de peligro'), h('button', {
        class: 'btn danger', type: 'button',
        onclick: async () => {
          const ok = await confirmDialog({ title: 'Eliminar servicio', message: `¿Eliminar "${s.name}" y todo su historial?`, ok: 'Eliminar', danger: true });
          if (!ok) return;
          v.services = v.services.filter(x => x !== s);
          save(true);
          await sh.close();
          toast('Servicio eliminado');
        },
      }, '🗑️ Eliminar servicio')) : null);

    refreshStatus();
    refreshHist();
    receiptBox(s, receiptWrap);
  }

  function receiptBox(s, wrap) {
    wrap.replaceChildren();
    const r = s.receipt;
    if (r) {
      if (r.type.startsWith('image/')) {
        wrap.append(h('img', { class: 'receipt-img', src: r.data, alt: 'Foto del recibo', onclick: () => openReceipt(r) }));
      } else {
        wrap.append(h('div', { class: 'pdf-item' }, h('span', { class: 'big' }, '📄'), h('span', null, r.name || 'recibo.pdf')));
      }
      wrap.append(h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: () => openReceipt(r) }, 'Abrir'),
        h('button', {
          class: 'btn danger', type: 'button',
          onclick: async () => {
            if (!(await confirmDialog({ title: 'Quitar recibo', message: '¿Quitar el recibo adjunto?', ok: 'Quitar', danger: true }))) return;
            s.receipt = null; save(); receiptBox(s, wrap);
          },
        }, 'Quitar')));
    }
    wrap.append(h('button', { class: 'btn', type: 'button', onclick: () => pickReceipt(s, wrap) }, r ? '📎 Reemplazar recibo' : '📷 Adjuntar foto o PDF'));
  }

  function pickReceipt(s, wrap) {
    const input = $('#fileReceipt');
    input.value = '';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        let data, type;
        if (isPdf) {
          if (file.size > MAX_RECEIPT_BYTES) return toast('El PDF supera 6 MB');
          data = await readAsDataURL(file);
          type = 'application/pdf';
          if (!/^data:application\/pdf;base64,/.test(data)) data = data.replace(/^data:[^;]*;/, 'data:application/pdf;');
        } else if (file.type.startsWith('image/')) {
          data = await compressImage(file);
          type = 'image/jpeg';
        } else {
          return toast('Solo se aceptan fotos o PDF');
        }
        s.receipt = { name: file.name.slice(0, 80), type, data, addedAt: Date.now() };
        save(true);
        receiptBox(s, wrap);
        toast('Recibo guardado ✓');
      } catch (e) {
        console.error(e);
        toast('No se pudo leer el archivo');
      }
    };
    input.click();
  }
  function readAsDataURL(file) {
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsDataURL(file); });
  }
  async function compressImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const max = 1600;
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.8);
    } finally { URL.revokeObjectURL(url); }
  }
  function dataUrlToBlob(dataUrl) {
    const [head, b64] = dataUrl.split(',');
    const mime = (head.match(/^data:([^;]+)/) || [])[1] || 'application/octet-stream';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  function openReceipt(r) {
    if (r.type.startsWith('image/')) {
      openSheet({ title: 'Recibo', body: h('img', { class: 'viewer-img', src: r.data, alt: 'Recibo' }) });
      return;
    }
    const url = URL.createObjectURL(dataUrlToBlob(r.data));
    const w = window.open(url, '_blank');
    if (!w) { const a = h('a', { href: url, download: r.name || 'recibo.pdf' }); document.body.append(a); a.click(); a.remove(); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function newServiceSheet(v) {
    if (v.services.length >= MAX_SERVICES) return toast(`Máximo ${MAX_SERVICES} servicios`);
    const d = { name: '', icon: '🔧', miles: null, months: null };
    const grid = h('div', { class: 'icon-grid' });
    const drawGrid = () => grid.replaceChildren(...SERVICE_ICONS.map(ic => h('button', {
      class: 'icon-opt' + (ic === d.icon ? ' sel' : ''), type: 'button', 'aria-label': 'Ícono ' + ic,
      onclick: () => { d.icon = ic; drawGrid(); },
    }, ic)));
    drawGrid();
    const sh = openSheet({
      title: 'Nuevo servicio',
      body: h('div', null,
        field('Nombre', textInput('', val => { d.name = val.trim().slice(0, 60); }, { maxlength: 60, placeholder: 'Ej. Batería', autocapitalize: 'sentences' })),
        h('div', { class: 'row' },
          field('Cada (millas)', numInput(null, n => { d.miles = n; }, { maxlength: 7, placeholder: '10000' })),
          field('Cada (meses)', numInput(null, n => { d.months = n; }, { maxlength: 3, placeholder: '12' }))),
        h('p', { class: 'hint' }, 'Se avisará por millas o por tiempo, lo que ocurra primero. Puedes dejar uno vacío.'),
        secTitle('Ícono'), grid),
      footer: h('button', {
        class: 'btn primary lg', type: 'button',
        onclick: async () => {
          if (!d.name) return toast('Escribe un nombre');
          if (!d.miles && !d.months) return toast('Indica millas o meses');
          v.services.push(makeService({ name: d.name, icon: d.icon, miles: d.miles || 0, months: Math.min(d.months || 0, 240) }));
          save(true);
          await sh.close();
          toast(`${d.name} creado ✓`);
        },
      }, 'Crear servicio'),
    });
  }

  /* ---------- Pantalla 3: Vehículo ---------- */
  function renderVeh() {
    const root = $('#s-veh');
    root.replaceChildren();
    const v = activeVehicle();
    if (!v) { root.append(emptyState()); return; }
    const titleEl = h('div', { class: 'veh-title' }, vName(v));
    const proxy = {
      get year() { return v.year; }, set year(x) { v.year = x; changed(); },
      get make() { return v.make; }, set make(x) { v.make = x; changed(); },
      get model() { return v.model; }, set model(x) { v.model = x; changed(); },
      get engine() { return v.engine; }, set engine(x) { v.engine = x; changed(); },
      get vin() { return v.vin; }, set vin(x) { v.vin = x; changed(); },
    };
    function changed() { titleEl.textContent = vName(v); renderHeader(); save(); }

    const stateTxt = h('span');
    const setTxt = () => { stateTxt.textContent = v.notifications ? 'Activadas' : 'Desactivadas'; stateTxt.className = v.notifications ? 'on' : 'off'; };
    setTxt();

    root.append(
      h('div', { class: 'card' },
        titleEl,
        h('div', { class: 'veh-sub' }, `${fmt(v.odometer)} mi · ${v.services.length} servicios`),
        vehicleForm(proxy),
        h('button', {
          class: 'btn', type: 'button',
          onclick: async () => {
            if (!v.vin) return toast('Primero escribe el VIN');
            toast((await copyText(v.vin)) ? `VIN copiado: ${v.vin}` : 'No se pudo copiar');
          },
        }, '📋 Copiar VIN')),

      h('div', { class: 'card' },
        h('label', { class: 'toggle-row' },
          h('div', { class: 'toggle-text' },
            h('div', { class: 'toggle-title' }, 'Notificaciones: ', stateTxt),
            h('div', { class: 'hint' }, 'Incluir este vehículo en el recordatorio mensual.')),
          h('span', { class: 'switch' },
            h('input', {
              type: 'checkbox', role: 'switch', 'aria-label': 'Notificaciones de este vehículo', checked: v.notifications,
              onchange: e => { v.notifications = e.target.checked; setTxt(); save(); renderBadges(); },
            }),
            h('span', { class: 'track' })))),

      h('div', { class: 'card stack' },
        h('div', { class: 'card-title' }, 'Restaurar'),
        h('button', {
          class: 'btn', type: 'button',
          onclick: async () => {
            const ok = await confirmDialog({ title: 'Restaurar intervalos', message: 'Los 9 servicios predeterminados volverán a sus intervalos de fábrica. Tu historial, recibos y servicios personalizados no cambian.', ok: 'Restaurar' });
            if (!ok) return;
            for (const s of v.services) { const d = s.key && DEFAULT_BY_KEY[s.key]; if (d) { s.intervalMiles = d.miles; s.intervalMonths = d.months; } }
            save(true); render(); toast('Intervalos restaurados ✓');
          },
        }, '↺ Restaurar solo intervalos'),
        h('button', {
          class: 'btn danger', type: 'button',
          onclick: async () => {
            const ok = await confirmDialog({
              title: 'Restaurar vehículo de fábrica',
              message: `Se borrarán TODOS los registros, historial, productos, recibos y servicios personalizados de ${vName(v)}, y los intervalos volverán a fábrica.\n\nSe conservan Año, Marca, Modelo, Motor, VIN y el odómetro.`,
              ok: 'Restaurar todo', danger: true,
            });
            if (!ok) return;
            v.services = DEFAULT_SERVICES.map(makeService);
            v.notifications = true;
            save(true); render(); toast('Vehículo restaurado de fábrica');
          },
        }, '⚠️ Restaurar vehículo de fábrica')),

      h('div', { class: 'card' },
        h('button', {
          class: 'btn danger', type: 'button',
          onclick: async () => {
            const ok = await confirmDialog({ title: 'Eliminar vehículo', message: `¿Eliminar ${vName(v)} con todo su historial? Esta acción no se puede deshacer.\n\nConsejo: exporta un respaldo antes.`, ok: 'Eliminar', danger: true });
            if (!ok) return;
            state.vehicles = state.vehicles.filter(x => x !== v);
            state.activeId = state.vehicles[0] ? state.vehicles[0].id : null;
            save(true); go('odo'); toast('Vehículo eliminado');
          },
        }, '🗑️ Eliminar vehículo')));
  }

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) {
      const ta = h('textarea', { readonly: true });
      ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.append(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  /* ---------- Pantalla 4: Avisos y Copia ---------- */
  function renderAlerts() {
    const root = $('#s-alerts');
    root.replaceChildren();
    const inst = installCard();
    if (inst) root.append(inst);

    // Recordatorio inteligente
    const reminder = h('div', { class: 'card' }, h('div', { class: 'card-title' }, `Recordatorio de ${mf.format(new Date())}`));
    if (!state.vehicles.length) {
      reminder.append(h('p', { class: 'muted' }, 'Añade un vehículo para recibir recordatorios.'));
    } else {
      const withNotif = state.vehicles.filter(v => v.notifications);
      const pend = pendingVehicles();
      const overdue = withNotif.map(v => ({ v, list: v.services.filter(s => svcStatus(v, s).code === 'due') })).filter(x => x.list.length);
      if (!withNotif.length) {
        reminder.append(h('p', { class: 'muted' }, 'Todos los vehículos tienen las notificaciones desactivadas.'));
      } else if (pend.length) {
        reminder.append(h('p', null, pend.length === 1 ? 'Falta por actualizar el odómetro de:' : `Faltan ${pend.length} vehículos por actualizar el odómetro:`),
          h('ul', { class: 'veh-list' }, pend.map(v => h('li', null,
            h('span', { class: 'name' }, vName(v), h('span', { class: 'sub' }, relUpdated(v.odometerUpdatedAt))),
            h('button', { class: 'btn primary', type: 'button', onclick: () => { state.activeId = v.id; save(); go('odo'); } }, 'Actualizar')))));
      } else {
        reminder.append(h('p', { class: 'ok-msg' }, '✓ Todos tus vehículos con avisos están actualizados este mes.'));
      }
      if (overdue.length) {
        reminder.append(h('p', null, h('b', null, 'Con mantenimiento vencido:')),
          h('ul', { class: 'veh-list' }, overdue.map(({ v, list }) => h('li', null,
            h('span', { class: 'name' }, vName(v), h('span', { class: 'sub' }, list.map(s => s.name).join(', '))),
            h('button', { class: 'btn', type: 'button', onclick: () => { state.activeId = v.id; save(); go('svc'); } }, 'Ver')))));
      }
      const off = state.vehicles.length - withNotif.length;
      if (off && withNotif.length) reminder.append(h('p', { class: 'hint' }, `${off} vehículo(s) con notificaciones desactivadas no se incluyen.`));
    }
    root.append(reminder);

    // Calendario .ics
    const daySel = h('select', {
      class: 'input', 'aria-label': 'Día del mes',
      onchange: e => { state.settings.reminderDay = Number(e.target.value); save(); renderBadges(); },
    }, Array.from({ length: 28 }, (_, i) => h('option', { value: i + 1, selected: state.settings.reminderDay === i + 1 }, `Día ${i + 1} de cada mes`)));
    root.append(h('div', { class: 'card' },
      h('div', { class: 'card-title' }, '📅 Recordatorio en tu calendario'),
      h('p', { class: 'muted' }, 'Crea un evento mensual que nombra tus vehículos con notificaciones activadas.'),
      field('¿Qué día te recordamos?', daySel),
      h('button', { class: 'btn primary lg', type: 'button', onclick: downloadICS }, 'Descargar recordatorio (.ics)'),
      h('p', { class: 'hint' }, 'Ábrelo para añadirlo a Calendario de iPhone, Google Calendar u Outlook. Si añades vehículos, descárgalo de nuevo.')));

    // Avisos del dispositivo
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    const permTxt = { granted: '✓ Avisos permitidos en este dispositivo', denied: 'Bloqueados: actívalos en los ajustes del navegador', default: 'Aún no has dado permiso', unsupported: isIOS ? 'Instala la app en la pantalla de inicio (iOS 16.4+) para usar avisos' : 'Este navegador no admite avisos' }[perm];
    root.append(h('div', { class: 'card' },
      h('div', { class: 'card-title' }, '🔔 Avisos en este dispositivo'),
      h('p', { class: perm === 'granted' ? 'ok-msg' : 'muted' }, permTxt),
      perm === 'default' ? h('button', { class: 'btn', type: 'button', onclick: requestNotif }, 'Permitir avisos') : null,
      h('p', { class: 'hint' }, 'Al abrir la app a partir del día elegido verás un aviso con los vehículos pendientes. Para avisos aunque no abras la app, usa el calendario.')));

    // Copia de seguridad
    const lb = state.settings.lastBackup;
    root.append(h('div', { class: 'card stack' },
      h('div', { class: 'card-title' }, '💾 Copia de seguridad'),
      h('p', { class: 'muted' }, lb ? `Último respaldo: ${df.format(new Date(lb))}` : 'Aún no has hecho ningún respaldo.'),
      h('button', { class: 'btn primary lg', type: 'button', onclick: exportBackup }, '⬇️ Exportar respaldo (JSON)'),
      h('button', { class: 'btn lg', type: 'button', onclick: importBackup }, '⬆️ Importar respaldo'),
      h('p', { class: 'hint' }, 'El respaldo incluye vehículos, servicios, historial y recibos. Guárdalo en tu nube o correo.')));

    // Almacenamiento
    const storeTxt = h('p', { class: 'hint' }, `Guardado automático en este dispositivo (${Store.backend}).`);
    root.append(h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Almacenamiento'), storeTxt,
      h('p', { class: 'hint' }, `AutoControl Pro v${APP_VERSION} · funciona sin conexión`)));
    (async () => {
      try {
        const parts = [`Guardado automático en este dispositivo (${Store.backend}).`];
        if (navigator.storage && navigator.storage.persisted) parts.push((await navigator.storage.persisted()) ? 'Almacenamiento persistente: sí.' : 'Almacenamiento persistente: no garantizado (instala la app y haz respaldos).');
        if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); if (e.usage != null) parts.push(`Uso: ${(e.usage / 1048576).toFixed(1)} MB.`); }
        storeTxt.textContent = parts.join(' ');
      } catch (e) { /* sin datos */ }
    })();
  }

  function installCard() {
    if (isStandalone()) return null;
    if (deferredInstall) {
      return h('div', { class: 'card' },
        h('div', { class: 'card-title' }, '📲 Instala la app'),
        h('p', { class: 'muted' }, 'Ábrela desde tu pantalla de inicio, a pantalla completa y sin conexión.'),
        h('button', {
          class: 'btn primary lg', type: 'button',
          onclick: async () => { const p = deferredInstall; deferredInstall = null; p.prompt(); try { await p.userChoice; } catch (e) { /* ignorar */ } render(); },
        }, 'Instalar AutoControl Pro'));
    }
    return h('div', { class: 'card' },
      h('div', { class: 'card-title' }, '📲 Instala la app'),
      h('p', { class: 'muted' }, isIOS
        ? 'En Safari toca Compartir (cuadro con flecha ⬆️) y luego "Añadir a pantalla de inicio".'
        : 'En Chrome abre el menú ⋮ y toca "Instalar app" o "Añadir a pantalla de inicio".'));
  }

  async function requestNotif() {
    if (!('Notification' in window)) return toast('Este navegador no admite avisos');
    try {
      const p = await Notification.requestPermission();
      if (p === 'granted') { toast('Avisos activados ✓'); state.settings.lastNotified = null; checkMonthlyReminder(); }
      else toast('Permiso no concedido');
    } catch (e) { toast('No se pudo pedir permiso'); }
    render();
  }

  async function checkMonthlyReminder() {
    renderBadges();
    const pend = pendingVehicles();
    if (!pend.length || !reminderActive()) return;
    if (state.settings.lastNotified === monthKey()) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const body = `Actualiza el odómetro de: ${joinNames(pend.map(vName))}.`;
    try {
      const reg = navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null;
      if (reg) await reg.showNotification('AutoControl Pro · Recordatorio mensual', { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'monthly-reminder' });
      else new Notification('AutoControl Pro · Recordatorio mensual', { body, icon: 'icons/icon-192.png' });
      state.settings.lastNotified = monthKey();
      save();
    } catch (e) { console.warn('Notificación', e); }
  }

  /* ---------- Calendario .ics ---------- */
  function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;'); }
  function icsFold(line) {
    const enc = new TextEncoder();
    if (enc.encode(line).length <= 75) return line;
    const out = []; let cur = '';
    for (const ch of line) {
      const limit = out.length ? 74 : 75;
      if (enc.encode(cur + ch).length > limit) { out.push(cur); cur = ch; } else cur += ch;
    }
    out.push(cur);
    return out.join('\r\n ');
  }
  function buildICS() {
    const day = state.settings.reminderDay;
    const names = state.vehicles.filter(v => v.notifications).map(vName);
    const now = new Date();
    let start = new Date(now.getFullYear(), now.getMonth(), day, 9, 0, 0);
    if (start < now) start = new Date(now.getFullYear(), now.getMonth() + 1, day, 9, 0, 0);
    const local = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const summary = names.length === 0 ? 'Actualizar odómetro (AutoControl Pro)'
      : names.length <= 2 ? `Actualizar odómetro: ${joinNames(names)}`
      : `Actualizar odómetro de ${names.length} vehículos`;
    const desc = names.length
      ? `Abre AutoControl Pro y actualiza el odómetro de:\n${names.map(n => '• ' + n).join('\n')}\n\nRevisa también los servicios próximos o vencidos.`
      : 'Abre AutoControl Pro y actualiza el odómetro de tus vehículos.';
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AutoControl Pro//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:autocontrol-pro-recordatorio-mensual@autocontrol.app',
      'DTSTAMP:' + stamp,
      'DTSTART:' + local(start),
      'DURATION:PT15M',
      'RRULE:FREQ=MONTHLY;BYMONTHDAY=' + day,
      'SUMMARY:' + icsEscape(summary),
      'DESCRIPTION:' + icsEscape(desc),
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT0M', 'DESCRIPTION:' + icsEscape(summary), 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR',
    ];
    return lines.map(icsFold).join('\r\n') + '\r\n';
  }
  async function downloadICS() {
    const blob = new Blob([buildICS()], { type: 'text/calendar;charset=utf-8' });
    await deliverFile(blob, 'autocontrol-recordatorio.ics', 'text/calendar');
    toast('Recordatorio listo: ábrelo para añadirlo a tu calendario');
  }

  async function deliverFile(blob, name, mime) {
    // En iPhone instalado, compartir es más fiable que descargar
    if (isIOS && navigator.canShare) {
      try {
        const file = new File([blob], name, { type: mime });
        if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return true; }
      } catch (e) { if (e && e.name === 'AbortError') return false; }
    }
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return true;
  }

  /* ---------- Respaldo JSON ---------- */
  async function exportBackup() {
    await flushSave();
    const payload = { app: APP_ID, schema: SCHEMA, appVersion: APP_VERSION, exportedAt: new Date().toISOString(), data: state };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const ok = await deliverFile(blob, `autocontrol-respaldo-${todayStr()}.json`, 'application/json');
    if (ok) { state.settings.lastBackup = Date.now(); save(); render(); toast('Respaldo exportado ✓'); }
  }

  function importBackup() {
    const input = $('#fileImport');
    input.value = '';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (file.size > MAX_IMPORT_BYTES) return infoDialog('Archivo demasiado grande', 'El archivo supera 60 MB y no parece un respaldo de AutoControl Pro.');
      let obj;
      try { obj = JSON.parse(await file.text()); } catch (e) {
        return infoDialog('Archivo no válido', 'El archivo está dañado o no es un JSON válido. No se cambió nada.');
      }
      const r = validateBackup(obj);
      if (!r.ok) return infoDialog('Respaldo rechazado', r.error + '\n\nNo se cambió nada.');
      const when = obj.exportedAt && !isNaN(Date.parse(obj.exportedAt)) ? df.format(new Date(obj.exportedAt)) : 'fecha desconocida';
      const msg = `Respaldo del ${when} con ${r.state.vehicles.length} vehículo(s):\n` +
        r.state.vehicles.map(v => '• ' + vName(v)).join('\n') +
        (r.warnings.length ? `\n\nAvisos:\n${r.warnings.slice(0, 6).map(w => '• ' + w).join('\n')}` : '') +
        '\n\nTus datos actuales se reemplazarán.';
      const ok = await confirmDialog({ title: 'Importar respaldo', message: msg, ok: 'Reemplazar datos', danger: true });
      if (!ok) return;
      r.state.settings.lastBackup = state.settings.lastBackup;
      state = r.state;
      save(true);
      go('odo');
      toast('Respaldo importado ✓');
    };
    input.click();
  }

  /* ---------- Validación estricta de datos ---------- */
  const isObj = o => o !== null && typeof o === 'object' && !Array.isArray(o);
  const vStr = (x, max) => (typeof x === 'string' ? x.trim().slice(0, max) : typeof x === 'number' && Number.isFinite(x) ? String(x).slice(0, max) : '');
  function vNum(x, min, max) {
    const n = typeof x === 'number' ? x : (typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN);
    return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
  }
  function vMoney(x) {
    const n = typeof x === 'number' ? x : (typeof x === 'string' ? parseMoney(x) : null);
    return n != null && Number.isFinite(n) && n >= 0 && n < 1e7 ? Math.round(n * 100) / 100 : null;
  }
  function vId(x, ids) {
    let id = typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x) && !ids.has(x) ? x : uid();
    while (ids.has(id)) id = uid();
    ids.add(id);
    return id;
  }
  const RECEIPT_RE = /^data:(image\/(png|jpeg|jpg|webp|gif)|application\/pdf);base64,[A-Za-z0-9+/]+={0,2}$/;

  function sanitizeService(rs, ids, warnings, vLabel) {
    if (!isObj(rs)) { warnings.push(`${vLabel}: se omitió un servicio inválido`); return null; }
    const name = vStr(rs.name, 60);
    if (!name) { warnings.push(`${vLabel}: se omitió un servicio sin nombre`); return null; }
    const key = typeof rs.key === 'string' && DEFAULT_BY_KEY[rs.key] ? rs.key : null;
    const def = key ? DEFAULT_BY_KEY[key] : null;
    const im = vNum(rs.intervalMiles, 0, 1000000);
    const imo = vNum(rs.intervalMonths, 0, 240);
    const d = isObj(rs.details) ? rs.details : {};
    let receipt = null;
    if (isObj(rs.receipt)) {
      const data = typeof rs.receipt.data === 'string' ? rs.receipt.data : '';
      if (data.length < MAX_RECEIPT_BYTES * 1.4 && RECEIPT_RE.test(data)) {
        const type = data.slice(5, data.indexOf(';'));
        receipt = { name: vStr(rs.receipt.name, 80) || 'recibo', type, data, addedAt: vNum(rs.receipt.addedAt, 0, 9e15) || Date.now() };
      } else warnings.push(`${vLabel} · ${name}: recibo dañado omitido`);
    }
    const history = [];
    if (Array.isArray(rs.history)) {
      for (const e of rs.history.slice(0, MAX_HISTORY)) {
        if (!isObj(e)) continue;
        const date = validDateStr(e.date);
        if (!date) continue;
        history.push({
          id: vId(e.id, ids), date, miles: vNum(e.miles, 0, MAX_ODO) ?? 0, price: vMoney(e.price),
          product: vStr(e.product, 80), notes: vStr(e.notes, 500),
        });
      }
    }
    const s = {
      id: vId(rs.id, ids), key, name, icon: vStr(rs.icon, 8) || (def ? def.icon : '🔧'),
      intervalMiles: im ?? (def ? def.miles : 0), intervalMonths: imo ?? (def ? def.months : 0),
      lastMiles: vNum(rs.lastMiles, 0, MAX_ODO), lastDate: validDateStr(rs.lastDate),
      details: {
        product: vStr(d.product, 80), partNumber: vStr(d.partNumber, 40), store: vStr(d.store, 80),
        price: vMoney(d.price), warranty: vStr(d.warranty, 80), notes: vStr(d.notes, 1000),
      },
      receipt, history,
    };
    sortHistory(s);
    return s;
  }

  function sanitizeVehicle(rv, idx, ids, warnings) {
    if (!isObj(rv)) { warnings.push(`Se omitió el vehículo #${idx + 1} (inválido)`); return null; }
    const v = {
      id: vId(rv.id, ids),
      year: (vStr(rv.year, 4).match(/^\d{4}$/) || [''])[0],
      make: vStr(rv.make, 40), model: vStr(rv.model, 40), engine: vStr(rv.engine, 40),
      vin: cleanVin(vStr(rv.vin, 30)),
      odometer: vNum(rv.odometer, 0, MAX_ODO) ?? 0,
      odometerUpdatedAt: vNum(rv.odometerUpdatedAt, 0, 9e15),
      notifications: rv.notifications !== false,
      createdAt: vNum(rv.createdAt, 0, 9e15) || Date.now(),
      services: [],
    };
    const label = vName(v);
    if (Array.isArray(rv.services)) {
      const seenKeys = new Set();
      for (const rs of rv.services.slice(0, MAX_SERVICES)) {
        const s = sanitizeService(rs, ids, warnings, label);
        if (!s) continue;
        if (s.key) { if (seenKeys.has(s.key)) s.key = null; else seenKeys.add(s.key); }
        v.services.push(s);
      }
      if (rv.services.length > MAX_SERVICES) warnings.push(`${label}: solo se importaron ${MAX_SERVICES} servicios`);
      // Garantiza los 9 predeterminados
      for (const d of DEFAULT_SERVICES) if (!seenKeys.has(d.key) && v.services.length < MAX_SERVICES) v.services.push({ ...makeService(d), id: vId(null, ids) });
    } else {
      v.services = DEFAULT_SERVICES.map(d => ({ ...makeService(d), id: vId(null, ids) }));
    }
    return v;
  }

  function validateBackup(obj) {
    const fail = error => ({ ok: false, error });
    if (!isObj(obj)) return fail('El archivo no contiene un respaldo válido.');
    if (obj.app !== APP_ID) return fail('Este archivo no es un respaldo de AutoControl Pro.');
    if (typeof obj.schema === 'number' && obj.schema > SCHEMA) return fail('El respaldo viene de una versión más nueva de la app. Actualiza la app primero.');
    const data = isObj(obj.data) ? obj.data : obj;
    if (!Array.isArray(data.vehicles)) return fail('Falta la lista de vehículos o está dañada.');
    if (data.vehicles.length > MAX_VEHICLES) return fail(`El respaldo tiene ${data.vehicles.length} vehículos; el máximo es ${MAX_VEHICLES}.`);
    const warnings = [];
    const ids = new Set();
    const vehicles = data.vehicles.map((rv, i) => sanitizeVehicle(rv, i, ids, warnings)).filter(Boolean);
    const rs = isObj(data.settings) ? data.settings : {};
    const activeId = typeof data.activeId === 'string' && vehicles.some(v => v.id === data.activeId) ? data.activeId : (vehicles[0] ? vehicles[0].id : null);
    return {
      ok: true, warnings,
      state: {
        app: APP_ID, schema: SCHEMA, vehicles, activeId,
        settings: {
          reminderDay: vNum(rs.reminderDay, 1, 28) || 1,
          lastNotified: typeof rs.lastNotified === 'string' && /^\d{4}-\d{2}$/.test(rs.lastNotified) ? rs.lastNotified : null,
          lastBackup: vNum(rs.lastBackup, 0, 9e15),
        },
      },
    };
  }

  /* =========================================================
     7. Inicio
     ========================================================= */
  async function init() {
    await Store.open();
    const loaded = await Store.get();
    if (loaded) {
      const r = validateBackup(loaded);
      state = r.ok ? r.state : newState();
      if (!r.ok) console.warn('Datos locales inválidos, se reinicia:', r.error);
    } else {
      state = newState();
    }

    document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
    $('#vehBtn').addEventListener('click', vehiclePicker);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushSave();
      else if (!sheetStack.length) { render(); checkMonthlyReminder(); }
    });
    window.addEventListener('pagehide', () => { flushSave(); });

    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; if (current === 'alerts' && !sheetStack.length) render(); });
    window.addEventListener('appinstalled', () => { deferredInstall = null; toast('App instalada ✓'); });

    go('odo');
    checkMonthlyReminder();

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('service-worker.js').catch(err => console.warn('SW', err));
    }
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* no soportado */ }
  }

  init();
})();
