// Schedule logic shared by the phone PWA and the webOS TV app.
//
// Pure functions only: no DOM, no network. Kept to syntax that older TV
// browsers understand (no ?. or ??), because the TV build concatenates this
// file into a plain script.
//
// All instants in state.json are ISO-8601 UTC strings. Daily times
// ("08:00") are wall-clock times in state.timezone.

export var HOUR_MS = 3600000;
export var DEFAULT_EARLY_WINDOW_HOURS = 2;
export var DEFAULT_LOG_LIMIT = 500;
export var DEFAULT_SHORT_GAP_WARNING_HOURS = 12;

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

var partsFormatters = {};

// Wall-clock parts of instant t (ms) in time zone tz.
export function partsInTz(t, tz) {
  var f = partsFormatters[tz];
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short'
    });
    partsFormatters[tz] = f;
  }
  var p = {};
  f.formatToParts(new Date(t)).forEach(function (x) { p[x.type] = x.value; });
  return {
    y: +p.year, m: +p.month, d: +p.day,
    h: (+p.hour) % 24, mi: +p.minute, s: +p.second, weekday: p.weekday
  };
}

// Offset (ms) of tz from UTC at instant t.
function tzOffset(t, tz) {
  var p = partsInTz(t, tz);
  var whole = Math.floor(t / 1000) * 1000;
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - whole;
}

// Instant (ms) of a local wall-clock time in tz. Month is 1-based.
export function localToInstant(y, m, d, h, mi, tz) {
  var guess = Date.UTC(y, m - 1, d, h, mi);
  var t = guess - tzOffset(guess, tz);
  // Second pass corrects for a DST change between guess and t.
  return guess - tzOffset(t, tz);
}

export function parseHhMm(s) {
  var m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(s));
  if (!m) throw new Error('Bad time "' + s + '", expected HH:MM');
  return { h: +m[1], mi: +m[2] };
}

// First daily slot at local time hhmm in tz that is strictly after t.
export function nextDailySlotAfter(t, hhmm, tz) {
  var hm = parseHhMm(hhmm);
  var p = partsInTz(t, tz);
  for (var k = -1; k <= 2; k++) {
    var day = new Date(Date.UTC(p.y, p.m - 1, p.d + k));
    var slot = localToInstant(day.getUTCFullYear(), day.getUTCMonth() + 1,
      day.getUTCDate(), hm.h, hm.mi, tz);
    if (slot > t) return slot;
  }
  throw new Error('No daily slot found');
}

// When the next dose is due if this med is given at givenAt (ms).
//
// interval: givenAt + hours. A late dose pushes the next one back, so the
//   gap after the actual dose is always the full interval.
// daily: the next fixed-time slot after (givenAt + early window). A dose
//   given up to early_window_hours before the slot, or any time after it,
//   counts for that slot. Logging late never moves the next day's time.
export function nextDueAfterGiven(med, givenAt, tz) {
  var s = med.schedule;
  if (s.type === 'interval') {
    if (!(s.hours > 0)) throw new Error(med.id + ': interval hours must be > 0');
    return givenAt + s.hours * HOUR_MS;
  }
  if (s.type === 'daily') {
    var early = s.early_window_hours == null ? DEFAULT_EARLY_WINDOW_HOURS : s.early_window_hours;
    return nextDailySlotAfter(givenAt + early * HOUR_MS, s.time, tz);
  }
  throw new Error(med.id + ': unknown schedule type "' + s.type + '"');
}

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

// Meds that share a `group` are given together and share one timer.
// A "unit" is a group, or a single med without a group.
export function getUnits(state) {
  var units = [];
  var byId = {};
  state.meds.forEach(function (med) {
    var id = med.group || med.id;
    if (!byId[id]) {
      byId[id] = { id: id, meds: [] };
      units.push(byId[id]);
    }
    byId[id].meds.push(med);
  });
  return units;
}

export function findUnit(state, unitId) {
  var units = getUnits(state);
  for (var i = 0; i < units.length; i++) if (units[i].id === unitId) return units[i];
  return null;
}

export function unitLabel(unit) {
  return unit.meds.map(function (m) { return m.name; }).join(' + ');
}

function maxTime(meds, key) {
  var best = null;
  meds.forEach(function (m) {
    var v = m[key];
    var t = v && typeof v === 'object' ? Date.parse(v.at) : (v ? Date.parse(v) : NaN);
    if (!isNaN(t) && (best === null || t > best)) best = t;
  });
  return best;
}

function minTime(meds, key) {
  var best = null;
  meds.forEach(function (m) {
    var t = m[key] ? Date.parse(m[key]) : NaN;
    if (!isNaN(t) && (best === null || t < best)) best = t;
  });
  return best;
}

// Status for display. soonMinutes: how far ahead counts as "soon".
export function unitStatus(unit, now, soonMinutes) {
  if (soonMinutes == null) soonMinutes = 30;
  var nextDue = minTime(unit.meds, 'next_due');
  var lastAt = maxTime(unit.meds, 'last_given');
  var lastBy = null;
  unit.meds.forEach(function (m) {
    if (m.last_given && Date.parse(m.last_given.at) === lastAt) lastBy = m.last_given.by;
  });
  var level;
  if (nextDue === null) level = 'unknown';
  else if (now >= nextDue) level = 'due';
  else if (nextDue - now <= soonMinutes * 60000) level = 'soon';
  else level = 'ok';
  return { level: level, nextDue: nextDue, lastGiven: lastAt, lastBy: lastBy };
}

export function validateState(state) {
  var errors = [];
  if (!state || typeof state !== 'object') return ['state is not an object'];
  if (!state.timezone) errors.push('timezone is missing');
  else {
    try { new Intl.DateTimeFormat('en-US', { timeZone: state.timezone }); }
    catch (e) { errors.push('timezone "' + state.timezone + '" is not valid'); }
  }
  if (!Array.isArray(state.meds) || !state.meds.length) errors.push('meds must be a non-empty array');
  else {
    var seen = {};
    state.meds.forEach(function (m, i) {
      var where = 'meds[' + i + ']';
      if (!m.id) errors.push(where + ': id is missing');
      else if (seen[m.id]) errors.push(where + ': duplicate id "' + m.id + '"');
      seen[m.id] = true;
      if (!m.name) errors.push(where + ': name is missing');
      var s = m.schedule;
      if (!s) errors.push(where + ': schedule is missing');
      else if (s.type === 'daily') {
        try { parseHhMm(s.time); } catch (e) { errors.push(where + ': ' + e.message); }
      } else if (s.type === 'interval') {
        if (!(s.hours > 0)) errors.push(where + ': interval hours must be > 0');
      } else errors.push(where + ': unknown schedule type');
    });
    getUnits(state).forEach(function (u) {
      if (u.meds.length < 2) return;
      var first = JSON.stringify(u.meds[0].schedule);
      u.meds.forEach(function (m) {
        if (JSON.stringify(m.schedule) !== first) {
          errors.push('group "' + u.id + '": all meds in a group need the same schedule');
        }
      });
    });
  }
  if (state.subscriptions != null && !Array.isArray(state.subscriptions)) {
    errors.push('subscriptions must be an array');
  }
  return errors;
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Preview of what logging a dose would do, without changing state.
export function previewGiven(state, unitId, givenAtIso) {
  var unit = findUnit(state, unitId);
  if (!unit) throw new Error('Unknown med or group "' + unitId + '"');
  var givenAt = Date.parse(givenAtIso);
  if (isNaN(givenAt)) throw new Error('Bad time');
  var nextDue = nextDueAfterGiven(unit.meds[0], givenAt, state.timezone);
  var warning = null;
  var sched = unit.meds[0].schedule;
  var pending = minTime(unit.meds, 'next_due');
  var last = maxTime(unit.meds, 'last_given');
  if (sched.type === 'daily') {
    if (last !== null && last <= givenAt &&
        nextDueAfterGiven(unit.meds[0], last, state.timezone) === nextDue) {
      warning = 'A dose was already logged since the last ' + sched.time +
        ' dose time. This would be an extra dose; the next one is still due at ' + sched.time + '.';
    } else {
      var gapWarn = sched.short_gap_warning_hours == null ? DEFAULT_SHORT_GAP_WARNING_HOURS : sched.short_gap_warning_hours;
      var gapH = (nextDue - givenAt) / HOUR_MS;
      if (gapH < gapWarn) {
        warning = 'The next dose would be due only ' + (Math.round(gapH * 10) / 10) +
          ' h after this one (at ' + sched.time + '). Check the vet\'s instructions.';
      }
    }
  } else if (pending !== null && givenAt < pending) {
    warning = 'Not due yet. Logging it now restarts the ' + sched.hours +
      '-hour timer from this time.';
  }
  return { unit: unit, nextDue: nextDue, warning: warning };
}

// Returns a new state with the dose logged for every med in the unit.
export function applyGiven(state, unitId, givenAtIso, by, nowMs) {
  var s = clone(state);
  var unit = findUnit(s, unitId);
  if (!unit) throw new Error('Unknown med or group "' + unitId + '"');
  var givenAt = Date.parse(givenAtIso);
  if (isNaN(givenAt)) throw new Error('Bad time "' + givenAtIso + '"');
  var now = nowMs == null ? Date.now() : nowMs;
  if (givenAt > now + 5 * 60000) throw new Error('Dose time is in the future');
  var at = new Date(givenAt).toISOString();
  var prev = {};
  unit.meds.forEach(function (m) {
    prev[m.id] = { last_given: m.last_given || null, next_due: m.next_due || null };
    m.last_given = { at: at, by: by || 'unknown' };
    m.next_due = new Date(nextDueAfterGiven(m, givenAt, s.timezone)).toISOString();
  });
  if (!Array.isArray(s.log)) s.log = [];
  s.log.push({
    id: newId(), type: 'given', unit: unitId,
    meds: unit.meds.map(function (m) { return m.id; }),
    at: at, by: by || 'unknown', logged_at: new Date(now).toISOString(), prev: prev
  });
  var limit = (s.settings && s.settings.log_limit) || DEFAULT_LOG_LIMIT;
  if (s.log.length > limit) s.log = s.log.slice(s.log.length - limit);
  return s;
}

// The most recent dose for a unit that can still be undone, or null.
// Only the latest dose can be undone, and only while nothing has replaced it.
export function undoableEntry(state, unitId) {
  var log = state.log || [];
  for (var i = log.length - 1; i >= 0; i--) {
    var e = log[i];
    if (e.unit !== unitId || e.type !== 'given') continue;
    if (e.undone_at) return null;
    var unit = findUnit(state, unitId);
    if (!unit) return null;
    var current = unit.meds.every(function (m) {
      return m.last_given && m.last_given.at === e.at;
    });
    return current ? e : null;
  }
  return null;
}

export function applyUndo(state, unitId, entryId, by, nowMs) {
  var s = clone(state);
  var e = undoableEntry(s, unitId);
  if (!e || e.id !== entryId) throw new Error('That dose can no longer be undone');
  var unit = findUnit(s, unitId);
  unit.meds.forEach(function (m) {
    var p = e.prev[m.id];
    if (!p) return;
    m.last_given = p.last_given;
    m.next_due = p.next_due;
  });
  e.undone_at = new Date(nowMs == null ? Date.now() : nowMs).toISOString();
  e.undone_by = by || 'unknown';
  return s;
}

// Adds or replaces a push subscription (matched by endpoint).
export function upsertSubscription(state, sub, name, nowMs) {
  var s = clone(state);
  if (!Array.isArray(s.subscriptions)) s.subscriptions = [];
  var json = sub.toJSON ? sub.toJSON() : sub;
  var entry = {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    name: name || 'unknown',
    added_at: new Date(nowMs == null ? Date.now() : nowMs).toISOString()
  };
  var replaced = false;
  s.subscriptions = s.subscriptions.map(function (x) {
    if (x.endpoint !== entry.endpoint) return x;
    replaced = true;
    entry.added_at = x.added_at || entry.added_at;
    return entry;
  });
  if (!replaced) s.subscriptions.push(entry);
  return s;
}

export function removeSubscription(state, endpoint) {
  var s = clone(state);
  s.subscriptions = (s.subscriptions || []).filter(function (x) { return x.endpoint !== endpoint; });
  return s;
}

export function hasSubscription(state, endpoint) {
  return (state.subscriptions || []).some(function (x) { return x.endpoint === endpoint; });
}

export { pad2 };
