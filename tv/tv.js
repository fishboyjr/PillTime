// webOS TV dashboard + toasts. Bundled by build.mjs together with app/lib/*.js
// into one plain script (file:// pages cannot load ES modules).
//
// Globals from the bundle: GitHubFile, getUnits, unitStatus, unitLabel,
// formatWhen, formatRelative, formatClock. From config.js: PILLTIME_CONFIG.

var POLL_MS = 60000;
var TOASTED_KEY = 'pilltime.tv.toasted';
var cfg = window.PILLTIME_CONFIG || {};
var gh = new GitHubFile({
  owner: cfg.owner, repo: cfg.repo, path: cfg.path || 'state.json',
  branch: cfg.branch || '', token: cfg.token
});
var state = null;
var lastOk = null;
var lastError = null;

function loadToasted() {
  try { return JSON.parse(localStorage.getItem(TOASTED_KEY)) || {}; } catch (e) { return {}; }
}
function saveToasted(t) {
  try { localStorage.setItem(TOASTED_KEY, JSON.stringify(t)); } catch (e) { /* ignore */ }
}

// System toast via luna://com.webos.notification/createToast.
// NOT YET VERIFIED against the current webOS TV SDK docs (see tv/README.md).
// If it fails, the in-app banner still shows while the app is open.
function systemToast(message) {
  if (!(window.webOS && webOS.service && webOS.service.request)) {
    console.log('webOSTV.js not loaded; toast skipped: ' + message);
    return;
  }
  webOS.service.request('luna://com.webos.notification', {
    method: 'createToast',
    parameters: { message: message.slice(0, 60) },
    onSuccess: function () { lastError = null; },
    onFailure: function (err) {
      lastError = 'Toast failed: ' + (err && (err.errorText || err.errorCode));
      render();
    }
  });
}

function maybeToast(now) {
  var toasted = loadToasted();
  var repeatMin = (state.settings && state.settings.tv_repeat_minutes) || 0;
  var dueNames = [];
  var keep = {};
  getUnits(state).forEach(function (unit) {
    var st = unitStatus(unit, now);
    if (st.level !== 'due') return;
    var key = unit.id + '@' + st.nextDue;
    var last = toasted[key];
    keep[key] = last;
    if (!last || (repeatMin > 0 && now - last >= repeatMin * 60000)) {
      keep[key] = now;
      dueNames.push(unitLabel(unit));
    }
  });
  saveToasted(keep); // drops keys for doses that are no longer due
  if (dueNames.length) systemToast('Dog meds due: ' + dueNames.join(', '));
}

function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

var LEVEL_TEXT = { due: 'DUE NOW', soon: 'DUE SOON', ok: 'OK', unknown: 'NOT LOGGED YET' };

function render() {
  var now = Date.now();
  var tz = (state && state.timezone) || undefined;
  document.getElementById('clock').textContent = tz ? formatClock(now, tz) : '';
  var box = document.getElementById('units');
  while (box.firstChild) box.removeChild(box.firstChild);
  var alertBox = document.getElementById('alert');
  var dueLabels = [];
  if (state) {
    getUnits(state).forEach(function (unit) {
      var st = unitStatus(unit, now);
      if (st.level === 'due') dueLabels.push(unitLabel(unit));
      var card = el('section', 'unit ' + st.level);
      card.appendChild(el('p', 'name', unitLabel(unit)));
      card.appendChild(el('p', 'state', LEVEL_TEXT[st.level]));
      card.appendChild(el('p', 'line', 'Next: ' + (st.nextDue == null ? '—'
        : formatWhen(st.nextDue, now, tz) + ' (' + formatRelative(st.nextDue, now) + ')')));
      card.appendChild(el('p', 'line', 'Last: ' + (st.lastGiven == null ? 'never'
        : formatWhen(st.lastGiven, now, tz) + ' by ' + (st.lastBy || 'unknown'))));
      box.appendChild(card);
    });
  }
  alertBox.hidden = !dueLabels.length;
  alertBox.textContent = dueLabels.length ? 'Due now: ' + dueLabels.join(', ') : '';
  var status = lastOk ? 'Updated ' + formatRelative(lastOk, now) : 'Connecting…';
  if (lastError) status += ' · ' + lastError;
  document.getElementById('status').textContent = status;
}

function poll() {
  gh.read().then(function (res) {
    state = res.data;
    lastOk = Date.now();
    lastError = null;
    maybeToast(lastOk);
    render();
  }, function (e) {
    lastError = e.message;
    render();
  });
}

if (!cfg.token) {
  lastError = 'No token in config.js. Rebuild with build.mjs.';
  render();
} else {
  poll();
  setInterval(poll, POLL_MS);
  setInterval(render, 15000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
}
