import {
  getUnits, unitStatus, unitLabel, findUnit, previewGiven, applyGiven,
  undoableEntry, applyUndo, upsertSubscription, removeSubscription,
  hasSubscription, validateState
} from './lib/schedule.js';
import { formatWhen, formatRelative } from './lib/format.js';
import { GitHubFile } from './lib/github.js';
import { DemoFile } from './lib/demo.js';

const CONFIG_KEY = 'pilltime.config';
const CACHE_KEY = 'pilltime.lastState';
const POLL_MS = 60000;

const $ = (id) => document.getElementById(id);

let config = loadConfig();
let gh = config ? makeClient(config) : null;
let state = loadCachedState();
let lastFetch = null;
let busy = false;

function loadConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(CONFIG_KEY));
    return c && (c.demo || (c.token && c.owner && c.repo)) ? c : null;
  } catch { return null; }
}

function loadCachedState() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; }
}

function cacheState(s) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(s)); } catch { /* storage full or blocked */ }
}

function makeClient(c) {
  if (c.demo) return new DemoFile();
  return new GitHubFile({ owner: c.owner, repo: c.repo, path: c.path || 'state.json', branch: c.branch || '', token: c.token });
}

function showBanner(text, info) {
  const b = $('banner');
  b.classList.toggle('info', !!info);
  b.textContent = text || '';
  b.hidden = !text;
}

function el(tag, attrs, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children) if (c != null) n.append(c);
  return n;
}

// ---------- views ----------

function showView(name) {
  $('view-meds').hidden = name !== 'meds';
  $('view-settings').hidden = name !== 'settings';
  if (name === 'settings') fillSettingsForm();
}

function fillSettingsForm() {
  const f = $('settings-form');
  const c = config || {};
  f.name.value = c.name || '';
  f.owner.value = c.owner || '';
  f.repo.value = c.repo || '';
  f.path.value = c.path || 'state.json';
  f.branch.value = c.branch || '';
  f.token.value = c.token || '';
  $('settings-cancel').hidden = !config;
  $('settings-error').hidden = true;
}

const LEVEL_TEXT = { due: 'DUE', soon: 'DUE SOON', ok: 'OK', unknown: 'NOT LOGGED YET' };

function render() {
  const cards = $('cards');
  cards.replaceChildren();
  if (!state) {
    cards.append(el('p', { class: 'muted' }, config ? 'Loading…' : 'Set up this phone to start.'));
    return;
  }
  const now = Date.now();
  const tz = state.timezone;
  for (const unit of getUnits(state)) {
    const st = unitStatus(unit, now);
    const undo = undoableEntry(state, unit.id);
    const facts = el('dl', { class: 'facts' },
      el('dt', {}, 'Next due'),
      el('dd', {}, st.nextDue == null ? 'After first dose is logged'
        : `${formatWhen(st.nextDue, now, tz)} (${formatRelative(st.nextDue, now)})`),
      el('dt', {}, 'Last given'),
      el('dd', {}, st.lastGiven == null ? 'Never'
        : `${formatWhen(st.lastGiven, now, tz)} by ${st.lastBy || 'unknown'}`)
    );
    const actions = el('div', { class: 'row' },
      el('button', { type: 'button', class: 'given', onclick: () => openGiven(unit.id), disabled: busy ? '' : null }, 'Given'));
    if (undo) {
      actions.append(el('button', { type: 'button', class: 'link', onclick: () => undoDose(unit.id, undo) }, 'Undo last'));
    }
    cards.append(el('article', { class: `card ${st.level}` },
      el('p', { class: 'card-title' }, unitLabel(unit)),
      el('span', { class: 'badge' }, LEVEL_TEXT[st.level]),
      facts, actions));
  }
  $('updated').textContent = lastFetch ? `Updated ${formatRelative(lastFetch, now)}` : 'Showing saved copy';
  renderHistory(now, tz);
  renderNotifyStatus();
}

function renderHistory(now, tz) {
  const list = $('history');
  list.replaceChildren();
  const entries = (state.log || []).filter((e) => e.type === 'given').slice(-10).reverse();
  if (!entries.length) {
    list.append(el('li', { class: 'muted' }, 'No doses logged yet.'));
    return;
  }
  for (const e of entries) {
    const unit = findUnit(state, e.unit);
    const label = unit ? unitLabel(unit) : e.unit;
    const text = `${formatWhen(Date.parse(e.at), now, tz)} · ${label} · ${e.by}` +
      (e.undone_at ? ` (undone by ${e.undone_by})` : '');
    list.append(el('li', { class: e.undone_at ? 'undone' : '' }, text));
  }
}

// ---------- data ----------

async function refresh() {
  if (!gh || busy) return;
  try {
    const { data } = await gh.read();
    const errors = validateState(data);
    if (errors.length) {
      showBanner(`state.json has problems: ${errors.join('; ')}`);
    } else {
      showBanner(config.demo ? 'Demo mode: sample data, saved only on this phone. Set up the real data repo in ⚙ when ready.' : '', true);
    }
    state = data;
    lastFetch = Date.now();
    cacheState(state);
    ensureSubscriptionSaved();
  } catch (e) {
    showBanner(navigator.onLine === false ? 'Offline. Showing the last saved copy.' : e.message);
  }
  render();
}

async function commit(mutate, message) {
  busy = true;
  render();
  try {
    const res = await gh.update((cur) => {
      const errors = validateState(cur);
      if (errors.length) throw new Error(`state.json has problems: ${errors.join('; ')}`);
      return mutate(cur);
    }, message);
    state = res.data;
    lastFetch = Date.now();
    cacheState(state);
    showBanner(config.demo ? 'Demo mode: sample data, saved only on this phone.' : '', true);
    return true;
  } catch (e) {
    showBanner(`Not saved: ${e.message}`);
    return false;
  } finally {
    busy = false;
    render();
  }
}

// ---------- given dialog ----------

function toLocalInput(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

let givenUnitId = null;

function openGiven(unitId) {
  if (!state) return;
  givenUnitId = unitId;
  const unit = findUnit(state, unitId);
  $('given-title').textContent = `Log ${unitLabel(unit)}`;
  const input = $('given-at');
  input.value = toLocalInput(Date.now());
  input.max = toLocalInput(Date.now() + 5 * 60000);
  $('given-error').hidden = true;
  updatePreview();
  $('given-dialog').showModal();
}

function updatePreview() {
  const t = new Date($('given-at').value).getTime();
  const warn = $('given-warning');
  if (isNaN(t)) {
    $('given-preview').textContent = '';
    warn.hidden = true;
    return;
  }
  try {
    const p = previewGiven(state, givenUnitId, new Date(t).toISOString());
    $('given-preview').textContent = `Next due: ${formatWhen(p.nextDue, Date.now(), state.timezone)}`;
    warn.textContent = p.warning || '';
    warn.hidden = !p.warning;
  } catch (e) {
    $('given-preview').textContent = e.message;
  }
}

async function confirmGiven(ev) {
  ev.preventDefault();
  const t = new Date($('given-at').value).getTime();
  const errBox = $('given-error');
  if (isNaN(t)) { errBox.textContent = 'Pick a time.'; errBox.hidden = false; return; }
  if (t > Date.now() + 5 * 60000) { errBox.textContent = 'That time is in the future.'; errBox.hidden = false; return; }
  $('given-dialog').close();
  const unitId = givenUnitId;
  const iso = new Date(t).toISOString();
  await commit((cur) => applyGiven(cur, unitId, iso, config.name), `Given: ${unitId} at ${iso} by ${config.name}`);
}

async function undoDose(unitId, entry) {
  const unit = findUnit(state, unitId);
  const when = formatWhen(Date.parse(entry.at), Date.now(), state.timezone);
  if (!confirm(`Undo the ${unitLabel(unit)} dose logged for ${when} by ${entry.by}?`)) return;
  await commit((cur) => applyUndo(cur, unitId, entry.id, config.name), `Undo: ${unitId} at ${entry.at} by ${config.name}`);
}

// ---------- push notifications ----------

const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function base64UrlToBytes(s) {
  const b64 = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSubscription() {
  if (!pushSupported) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function renderNotifyStatus() {
  const status = $('notify-status');
  const enable = $('notify-enable');
  const test = $('notify-test');
  const disable = $('notify-disable');
  if (!pushSupported) {
    status.textContent = isIos && !isStandalone
      ? 'On iPhone, first add this page to your Home Screen (Share → Add to Home Screen), then open it from there. Needs iOS 16.4 or later.'
      : 'This browser does not support push notifications.';
    enable.hidden = test.hidden = disable.hidden = true;
    return;
  }
  if (Notification.permission === 'denied') {
    status.textContent = 'Notifications are blocked for this app. Allow them in the phone settings, then come back.';
    enable.hidden = test.hidden = disable.hidden = true;
    return;
  }
  if (config && config.demo) {
    const granted = Notification.permission === 'granted';
    status.textContent = granted
      ? 'Demo mode: notifications are allowed. Real reminders need the data repo and its checker; the test below shows what one looks like.'
      : 'Demo mode: allow notifications to try a test notification. Real reminders need the data repo and its checker.';
    enable.hidden = granted;
    enable.textContent = 'Allow notifications';
    test.hidden = !granted;
    disable.hidden = true;
    return;
  }
  const sub = await currentSubscription().catch(() => null);
  const saved = sub && state && hasSubscription(state, sub.endpoint);
  if (saved) {
    status.textContent = 'On. This phone gets a notification when a dose is due.';
  } else if (sub) {
    status.textContent = 'Subscribed, but not yet saved to the shared file.';
  } else {
    status.textContent = 'Off.';
  }
  enable.hidden = !!saved;
  enable.textContent = sub ? 'Save' : 'Turn on';
  test.hidden = !sub;
  disable.hidden = !sub;
}

async function enableNotifications() {
  if (config && config.demo) {
    await Notification.requestPermission();
    renderNotifyStatus();
    return;
  }
  if (!state || !state.vapid_public_key) {
    showBanner('state.json has no vapid_public_key yet. See the setup guide.');
    return;
  }
  // Must run straight from the tap on iOS.
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { renderNotifyStatus(); return; }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(state.vapid_public_key)
      });
    }
    const json = sub.toJSON();
    await commit((cur) => upsertSubscription(cur, json, config.name), `Subscribe: ${config.name}`);
  } catch (e) {
    showBanner(`Could not turn on notifications: ${e.message}`);
  }
  renderNotifyStatus();
}

async function disableNotifications() {
  const sub = await currentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  await commit((cur) => (hasSubscription(cur, endpoint) ? removeSubscription(cur, endpoint) : null), `Unsubscribe: ${config.name}`);
  renderNotifyStatus();
}

async function testNotification() {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('PillTime test', { body: 'Notifications work on this phone.', tag: 'pilltime-test' });
}

// The browser can replace a subscription. Re-save it if it went missing.
let ensuring = false;
async function ensureSubscriptionSaved() {
  if (ensuring || !pushSupported || Notification.permission !== 'granted' || !state) return;
  ensuring = true;
  try {
    const sub = await currentSubscription();
    if (sub && !hasSubscription(state, sub.endpoint)) {
      const json = sub.toJSON();
      await commit((cur) => (hasSubscription(cur, json.endpoint) ? null : upsertSubscription(cur, json, config.name)),
        `Resubscribe: ${config.name}`);
    }
  } finally {
    ensuring = false;
  }
}

// ---------- settings ----------

async function saveSettings(ev) {
  ev.preventDefault();
  const f = ev.target;
  const next = {
    name: f.name.value.trim(),
    owner: f.owner.value.trim(),
    repo: f.repo.value.trim(),
    path: f.path.value.trim() || 'state.json',
    branch: f.branch.value.trim(),
    token: f.token.value.trim()
  };
  const err = $('settings-error');
  err.hidden = true;
  try {
    const client = makeClient(next);
    const { data } = await client.read();
    const problems = validateState(data);
    if (problems.length) throw new Error(`Connected, but state.json has problems: ${problems.join('; ')}`);
    localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
    config = next;
    gh = client;
    state = data;
    lastFetch = Date.now();
    cacheState(state);
    showView('meds');
    render();
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
}

async function startDemo() {
  const name = $('settings-form').name.value.trim() || 'Me';
  config = { demo: true, name };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  gh = makeClient(config);
  state = null;
  lastFetch = null;
  showView('meds');
  await refresh();
}

function forgetEverything() {
  if (!confirm('Remove the token and saved data from this phone?')) return;
  localStorage.removeItem(CONFIG_KEY);
  localStorage.removeItem(CACHE_KEY);
  DemoFile.reset();
  config = gh = state = null;
  showBanner('');
  fillSettingsForm();
}

// ---------- wiring ----------

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker failed', e));
}

$('refresh').addEventListener('click', refresh);
$('open-settings').addEventListener('click', () => showView('settings'));
$('settings-form').addEventListener('submit', saveSettings);
$('settings-cancel').addEventListener('click', () => showView('meds'));
$('settings-forget').addEventListener('click', forgetEverything);
$('settings-demo').addEventListener('click', startDemo);
$('given-at').addEventListener('input', updatePreview);
$('given-form').addEventListener('submit', (ev) => {
  if (ev.submitter && ev.submitter.value === 'cancel') return;
  confirmGiven(ev);
});
$('notify-enable').addEventListener('click', enableNotifications);
$('notify-disable').addEventListener('click', disableNotifications);
$('notify-test').addEventListener('click', testNotification);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);

if (config) {
  showView('meds');
  render();
  refresh();
} else {
  showView('settings');
}
