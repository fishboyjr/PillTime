// Pure decision logic for the scheduled checker. No network, so it is unit-tested
// from the code repo (test/checker.test.js).

// Same grouping rule as app/lib/schedule.js: meds sharing `group` are one unit.
export function getUnits(state) {
  const units = [];
  const byId = new Map();
  for (const med of state.meds) {
    const id = med.group || med.id;
    if (!byId.has(id)) {
      const u = { id, meds: [] };
      byId.set(id, u);
      units.push(u);
    }
    byId.get(id).meds.push(med);
  }
  return units;
}

function clock(t, tz) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(t))
    .replace(/\s/g, ' '); // some ICU versions put a narrow no-break space before AM/PM
}

// Which units need a push now. A unit is notified once per next_due value:
// `notified_for` on each med records the next_due it was sent for.
export function planNotifications(state, now) {
  const lead = ((state.settings && state.settings.notify_lead_minutes) || 0) * 60000;
  const plans = [];
  for (const unit of getUnits(state)) {
    const pending = unit.meds.filter((m) => m.next_due && m.notified_for !== m.next_due);
    if (!pending.length) continue;
    const due = Math.min(...pending.map((m) => Date.parse(m.next_due)));
    if (Number.isNaN(due) || now < due - lead) continue;
    const names = unit.meds.map((m) => m.name).join(' + ');
    const late = now - due;
    const body = late > 15 * 60000
      ? `${names}: overdue since ${clock(due, state.timezone)}`
      : `${names}: due ${clock(due, state.timezone)}`;
    plans.push({
      unit: unit.id,
      // The exact next_due values this push is for, per med.
      dueFor: Object.fromEntries(unit.meds.map((m) => [m.id, m.next_due])),
      payload: { title: 'Dog medication due', body, tag: `pilltime-${unit.id}` }
    });
  }
  return plans;
}

// Record what was sent and drop dead subscriptions. Safe to re-apply to a
// fresher copy of the state after a write conflict: a med whose next_due changed
// since planning (someone logged the dose) is left alone.
// Returns null if nothing changed.
export function applyResults(state, sentPlans, deadEndpoints) {
  const s = JSON.parse(JSON.stringify(state));
  let changed = false;
  for (const plan of sentPlans) {
    for (const med of s.meds) {
      const dueFor = plan.dueFor[med.id];
      if (dueFor && med.next_due === dueFor && med.notified_for !== dueFor) {
        med.notified_for = dueFor;
        changed = true;
      }
    }
  }
  const dead = new Set(deadEndpoints);
  if (dead.size && Array.isArray(s.subscriptions)) {
    const before = s.subscriptions.length;
    s.subscriptions = s.subscriptions.filter((x) => !dead.has(x.endpoint));
    if (s.subscriptions.length !== before) changed = true;
  }
  return changed ? s : null;
}
