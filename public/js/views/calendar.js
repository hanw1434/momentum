import { api } from '../api.js';
import { h, modal, confirmDialog, localDate, fmtTime } from '../ui.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const LEADS = [
  { m: 0, label: 'At time of event' },
  { m: 5, label: '5 minutes before' },
  { m: 10, label: '10 minutes before' },
  { m: 30, label: '30 minutes before' },
  { m: 60, label: '1 hour before' },
  { m: 120, label: '2 hours before' },
  { m: 1440, label: '1 day before' },
];

// Month being viewed persists across navigation within the session.
let viewYear = null;
let viewMonth = null;

export async function calendarView(root) {
  const now = new Date();
  if (viewYear === null) {
    viewYear = now.getFullYear();
    viewMonth = now.getMonth();
  }
  const { events } = await api('/api/events');
  const byDate = {};
  for (const e of events) (byDate[e.date] ||= []).push(e);
  for (const list of Object.values(byDate)) list.sort((a, b) => a.time.localeCompare(b.time));

  const refresh = () => calendarView(root);
  const todayIso = localDate(now);
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(viewYear, viewMonth, i - firstDow + 1);
    const iso = localDate(d);
    const inMonth = d.getMonth() === viewMonth;
    const evts = byDate[iso] || [];
    cells.push(
      h('div', {
        class: `cal-cell${inMonth ? '' : ' dim'}${iso === todayIso ? ' today' : ''}`,
        onclick: () => openEventModal(null, iso, refresh)
      },
        h('span', { class: 'cal-daynum' }, d.getDate()),
        evts.slice(0, 3).map(e =>
          h('div', {
            class: 'evt-chip', title: `${fmtTime(e.time)} ${e.title}`,
            onclick: ev => { ev.stopPropagation(); openEventModal(e, null, refresh); }
          },
            h('span', { class: 'evt-time' }, fmtTime(e.time).replace(' ', '')), ' ', e.title)),
        evts.length > 3 ? h('div', { class: 'muted small' }, `+${evts.length - 3} more`) : null));
  }

  root.replaceChildren(
    h('div', { class: 'page' },
      h('div', { class: 'page-head' },
        h('div', { class: 'row gap center' },
          h('button', { class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => { viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } refresh(); } }, '‹'),
          h('h1', { class: 'cal-title' }, `${MONTHS[viewMonth]} ${viewYear}`),
          h('button', { class: 'icon-btn', 'aria-label': 'Next month', onclick: () => { viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } refresh(); } }, '›'),
          h('button', { class: 'btn btn-ghost small-btn', onclick: () => { viewYear = now.getFullYear(); viewMonth = now.getMonth(); refresh(); } }, 'Today')),
        h('button', { class: 'btn btn-primary', onclick: () => openEventModal(null, todayIso, refresh) }, '+ New event')),
      h('div', { class: 'cal-dow' }, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => h('div', {}, d))),
      h('div', { class: 'cal-grid' }, cells),
      h('p', { class: 'muted small' }, 'Click a day to add an event. Reminders pop up as notifications while Momentum is open.')));
}

function openEventModal(event, defaultDate, onSaved) {
  const isNew = !event;
  const title = h('input', { class: 'input', placeholder: 'Event title', value: event?.title || '' });
  const date = h('input', { class: 'input', type: 'date', value: event?.date || defaultDate });
  const time = h('input', { class: 'input', type: 'time', value: event?.time || '09:00' });
  const desc = h('textarea', { class: 'input', rows: 3, placeholder: 'Description (optional)' });
  desc.value = event?.description || '';
  const err = h('p', { class: 'form-error' });

  const preset = new Set(LEADS.map(l => l.m));
  const selected = new Set(event ? event.reminders : [30]);
  const custom = h('input', {
    class: 'input custom-lead', type: 'number', min: 1, max: 20160, placeholder: 'e.g. 45',
    value: event ? (event.reminders.find(m => !preset.has(m)) ?? '') : ''
  });

  const boxes = LEADS.map(({ m, label }) => {
    const cb = h('input', {
      type: 'checkbox', checked: selected.has(m),
      onchange: () => cb.checked ? selected.add(m) : selected.delete(m)
    });
    return h('label', { class: 'check-option' }, cb, label);
  });

  const saveBtn = h('button', {
    class: 'btn btn-primary',
    onclick: async () => {
      err.textContent = '';
      if (!title.value.trim()) { err.textContent = 'Give the event a title.'; return; }
      if (!date.value || !time.value) { err.textContent = 'Pick a date and time.'; return; }
      const reminders = [...selected].filter(m => preset.has(m));
      const customMin = Math.round(Number(custom.value));
      if (custom.value && customMin > 0) reminders.push(customMin);
      try {
        await api(isNew ? '/api/events' : `/api/events/${event.id}`, {
          method: isNew ? 'POST' : 'PATCH',
          body: { title: title.value, description: desc.value, date: date.value, time: time.value, reminders }
        });
        m.close();
        window.dispatchEvent(new Event('events-changed'));
        onSaved();
      } catch (ex) {
        err.textContent = ex.message;
      }
    }
  }, isNew ? 'Add event' : 'Save changes');

  const actions = h('div', { class: 'row gap end' });
  if (!isNew) {
    actions.append(h('button', {
      class: 'btn btn-ghost',
      onclick: async () => {
        if (!(await confirmDialog(`Delete “${event.title}”?`))) return;
        await api(`/api/events/${event.id}`, { method: 'DELETE' });
        m.close();
        window.dispatchEvent(new Event('events-changed'));
        onSaved();
      }
    }, 'Delete'));
  }
  actions.append(saveBtn);

  const m = modal(isNew ? 'New event' : 'Edit event',
    h('div', { class: 'form-col' },
      title,
      h('div', { class: 'row gap' }, date, time),
      desc,
      h('div', { class: 'lead-box' },
        h('p', { class: 'picker-label' }, '⏰ Remind me…'),
        boxes,
        h('label', { class: 'check-option' }, 'Custom:', custom, h('span', { class: 'muted small' }, 'minutes before'))),
      err,
      actions));
  title.focus();
}
