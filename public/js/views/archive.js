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

function renderList(root, days, today) {
  root.replaceChildren(
    h('div', { class: 'page' },
      h('div', { class: 'page-head' },
        h('div', {},
          h('h1', {}, 'Archive'),
          h('p', { class: 'muted' }, 'Every day you’ve tracked, with tasks, time and reflections.'))),
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
