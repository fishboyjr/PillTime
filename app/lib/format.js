// Display helpers shared by the PWA and the TV app. Plain syntax for old TV browsers.
import { partsInTz, pad2 } from './schedule.js';

function dayNumber(p) {
  return Date.UTC(p.y, p.m - 1, p.d) / 86400000;
}

// "Today 14:00", "Tomorrow 08:00", "Yesterday 22:10", "Mon 9/11 08:00".
export function formatWhen(t, now, tz) {
  if (t == null) return '—';
  var p = partsInTz(t, tz);
  var n = partsInTz(now, tz);
  var hm = pad2(p.h) + ':' + pad2(p.mi);
  var diff = dayNumber(p) - dayNumber(n);
  if (diff === 0) return 'Today ' + hm;
  if (diff === 1) return 'Tomorrow ' + hm;
  if (diff === -1) return 'Yesterday ' + hm;
  return p.weekday + ' ' + p.d + '/' + p.m + ' ' + hm;
}

export function formatClock(t, tz) {
  var p = partsInTz(t, tz);
  return pad2(p.h) + ':' + pad2(p.mi);
}

// "in 2 h 5 min", "35 min ago", "now".
export function formatRelative(t, now) {
  if (t == null) return '';
  var mins = Math.round((t - now) / 60000);
  var abs = Math.abs(mins);
  if (abs < 1) return 'now';
  var h = Math.floor(abs / 60);
  var m = abs % 60;
  var text = h ? (h + ' h' + (m ? ' ' + m + ' min' : '')) : (m + ' min');
  return mins > 0 ? 'in ' + text : text + ' ago';
}
