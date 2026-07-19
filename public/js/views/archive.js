import { api } from '../api.js';
import { h, localDate, prettyDate, shortDate, fmtMinutes } from '../ui.js';

export async function archiveView(root, dateParam) {
  const { days } = await api('/api/days');
  const today = localDate();
  if (dateParam) {
    const day = days.find(d => d.date === dateParam);
    if (day) return renderDetail(root, day, today);
  }
  // Days planned ahead (e.g. tomorrow) live on the Today page until they arrive.
  renderList(root, days.filter(d => d.date <= today), today);
}

const stats = day => ({
  total: day.tasks.length,
  done: day.tasks.filter(t => t.completed).length,
  mins: day.tasks.reduce((s, t) => s + (t.minutes || 0), 0)
});

// ---------------- trend charts (Screen Time-style) ----------------

const RANGES = [
  { days: 7, label: 'Last 7 days', prev: 'previous 7 days' },
  { days: 14, label: 'Last 14 days', prev: 'previous 14 days' },
  { days: 30, label: 'Last 30 days', prev: 'previous 30 days' },
  { days: 0, label: 'All time', prev: '' },
];

// Selected range per chart persists while the app is open.
const chartRange = { pct: 0, mins: 0 };

// One point per calendar day in [today-(n-1) .. today] (offset shifts the
// window back for the previous-period comparison). Missing days count as 0.
function seriesFor(days, nDays, offset = 0) {
  const byDate = new Map(days.map(d => [d.date, d]));
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() - offset);
  let start;
  if (nDays) {
    start = new Date(end);
    start.setDate(start.getDate() - (nDays - 1));
  } else {
    const dates = days.map(d => d.date).sort();
    start = dates.length ? new Date(dates[0] + 'T00:00') : new Date(end);
  }
  const out = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const rec = byDate.get(localDate(d));
    const s = rec ? stats(rec) : { total: 0, done: 0, mins: 0 };
    out.push({
      date: localDate(d),
      dow: d.getDay(),
      tracked: !!rec, // blank days draw an empty bar but are excluded from averages
      pct: s.total ? (s.done / s.total) * 100 : 0,
      mins: s.mins
    });
  }
  return out;
}

const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

function statCard(kind, days) {
  const isPct = kind === 'pct';
  const card = h('div', {
    class: `card stat-card stat-${kind}`,
    role: 'button', tabindex: '0',
    title: 'Click to change the time range'
  });

  const render = () => {
    const range = RANGES[chartRange[kind]];
    const cur = seriesFor(days, range.days);
    // Averages divide by tracked days only — blank days are discarded.
    const trackedVals = cur.filter(p => p.tracked).map(p => isPct ? p.pct : p.mins);
    const average = avg(trackedVals);

    // Change vs the preceding period of equal length (not defined for all-time),
    // also averaged over that period's tracked days only.
    let change = null;
    let hasPrevData = false;
    if (range.days) {
      const prevVals = seriesFor(days, range.days, range.days).filter(p => p.tracked).map(p => isPct ? p.pct : p.mins);
      hasPrevData = prevVals.length > 0;
      const prevAvg = avg(prevVals);
      if (prevAvg > 0) change = Math.round(((average - prevAvg) / prevAvg) * 100);
    }
    const changeEl = range.days
      ? (change === null
          ? h('span', { class: 'stat-change flat' },
              hasPrevData ? `— vs ${range.prev}` : `no data in ${range.prev}`)
          : h('span', { class: `stat-change ${change > 0 ? 'up' : change < 0 ? 'down' : 'flat'}` },
              `${change > 0 ? '▲' : change < 0 ? '▼' : '—'} ${Math.abs(change)}% vs ${range.prev}`))
      : h('span', { class: 'stat-change flat' }, `${trackedVals.length} day${trackedVals.length === 1 ? '' : 's'} tracked`);

    const maxV = isPct ? 100 : Math.max(...cur.map(p => p.mins), 60);
    const bars = cur.map(p => {
      const v = isPct ? p.pct : p.mins;
      return h('div', {
        class: 'chart-col',
        title: `${shortDate(p.date)}: ${isPct ? Math.round(p.pct) + '% completed' : fmtMinutes(p.mins) + ' tracked'}`
      }, h('div', { class: 'chart-bar', style: `height:${Math.max((v / maxV) * 100, v > 0 ? 3 : 1.5)}%` }));
    });

    // Labels: weekday letters for a week, sparse date ticks otherwise.
    let labels;
    if (cur.length <= 7) {
      labels = h('div', { class: 'chart-labels' },
        cur.map(p => h('span', {}, 'SMTWTFS'[p.dow])));
    } else {
      const first = cur[0], mid = cur[Math.floor(cur.length / 2)], last = cur[cur.length - 1];
      const short = iso => new Date(iso + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      labels = h('div', { class: 'chart-ticks' },
        h('span', {}, short(first.date)), h('span', {}, short(mid.date)), h('span', {}, short(last.date)));
    }

    card.replaceChildren(
      h('div', { class: 'stat-head' },
        h('div', {},
          h('p', { class: 'stat-caption' }, isPct ? '✅ Tasks completed' : '⏱️ Time tracked'),
          h('p', { class: 'stat-big' },
            trackedVals.length === 0 ? '—' : isPct ? `${Math.round(average)}%` : fmtMinutes(Math.round(average))),
          h('p', { class: 'stat-sub muted small' },
            trackedVals.length === 0 ? 'no days tracked in this range'
              : `average over ${trackedVals.length} tracked day${trackedVals.length === 1 ? '' : 's'}`),
          changeEl),
        h('span', { class: 'range-pill' }, range.label)),
      h('div', { class: 'chart-wrap' },
        average > 0 ? h('div', { class: 'avg-line', style: `bottom:${(average / maxV) * 100}%` }) : null,
        h('div', { class: 'chart-bars' }, bars)),
      labels);
  };

  const cycle = () => {
    chartRange[kind] = (chartRange[kind] + 1) % RANGES.length;
    render();
  };
  card.addEventListener('click', cycle);
  card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cycle(); } });
  render();
  return card;
}

// ---------------- list & detail ----------------

function renderList(root, days, today) {
  root.replaceChildren(
    h('div', { class: 'page' },
      h('div', { class: 'page-head' },
        h('div', {},
          h('h1', {}, 'Archive'),
          h('p', { class: 'muted' }, 'Every day you’ve tracked, with tasks, time and reflections.'))),
      h('div', { class: 'stats-grid' },
        statCard('pct', days),
        statCard('mins', days)),
      days.length === 0
        ? h('div', { class: 'empty-state card' },
            h('span', { class: 'big' }, '📚'),
            h('p', {}, 'Nothing here yet — start your first checklist on the Today page.'))
        : h('div', { class: 'archive-list' },
            days.map(day => {
              const s = stats(day);
              const bar = h('div', { class: 'progress-fill', style: `width:${s.total ? (s.done / s.total) * 100 : 0}%` });
              return h('div', {
                class: 'card archive-card',
                onclick: () => { location.hash = `#/archive/${day.date}`; }
              },
                h('div', { class: 'head-row' },
                  h('span', { class: 'archive-date' }, shortDate(day.date)),
                  h('div', { class: 'row gap' },
                    day.date === today ? h('span', { class: 'badge' }, 'Today') : null,
                    h('span', { class: 'muted small' }, `${s.done}/${s.total} tasks · ${fmtMinutes(s.mins)}`))),
                h('div', { class: 'progress' }, bar),
                day.reflection
                  ? h('p', { class: 'reflection-snippet' }, `“${day.reflection.slice(0, 140)}${day.reflection.length > 140 ? '…' : ''}”`)
                  : null);
            }))));
}

function renderDetail(root, day, today) {
  const s = stats(day);
  root.replaceChildren(
    h('div', { class: 'page' },
      h('a', { class: 'back-link', href: '#/archive' }, '← Back to archive'),
      h('div', { class: 'page-head' },
        h('div', {},
          h('h1', {}, prettyDate(day.date)),
          h('p', { class: 'muted' }, `${s.done}/${s.total} tasks completed · ${fmtMinutes(s.mins)} tracked`)),
        day.date === today ? h('a', { class: 'btn btn-ghost small-btn', href: '#/today' }, 'Open in Today') : null),
      h('div', { class: 'card' },
        s.total === 0
          ? h('p', { class: 'muted' }, 'No tasks were added on this day.')
          : day.tasks.map(t =>
              h('div', { class: 'archive-task' },
                h('span', { class: `task-mark${t.completed ? ' done' : ''}` }, t.completed ? '✓' : '○'),
                h('span', { class: 'task-title' }, t.title),
                h('span', { class: 'muted small' }, fmtMinutes(t.minutes))))),
      h('div', { class: 'card' },
        h('h2', {}, '🪞 Reflection'),
        day.reflection
          ? h('p', { class: 'reflection-full', style: 'margin-top:10px' }, day.reflection)
          : h('p', { class: 'muted', style: 'margin-top:10px' }, 'No reflection was recorded for this day.'))));
}
