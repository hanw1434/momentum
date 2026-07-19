import { api } from '../api.js';
import { h, toast, confirmDialog, localDate, prettyDate, fmtMinutes } from '../ui.js';

// Running task timers: taskId -> { startedAt, intervalId }
const timers = new Map();

function stopAllTimers() {
  for (const t of timers.values()) clearInterval(t.intervalId);
  timers.clear();
}

// Handles both '#/today' and '#/today/tomorrow' (planning ahead).
export async function todayView(root, param) {
  stopAllTimers();
  const isTomorrow = param === 'tomorrow';
  const base = new Date();
  if (isTomorrow) base.setDate(base.getDate() + 1);
  const date = localDate(base);
  let day = null;
  try { ({ day } = await api(`/api/days/${date}`)); } catch { /* not started yet */ }
  if (!day) return renderStarter(root, date, isTomorrow);
  renderDay(root, day, isTomorrow);
}

// ---- day not started: pick presets ----

async function renderStarter(root, date, isTomorrow) {
  let presets = [];
  try { ({ presets } = await api('/api/presets')); } catch { /* show blank starter */ }
  const selected = new Set(presets.map(p => p.id));

  const startBtn = h('button', {
    class: 'btn btn-primary',
    onclick: async () => {
      startBtn.disabled = true;
      try {
        const { day } = await api('/api/days', { method: 'POST', body: { date, presetIds: [...selected] } });
        renderDay(root, day, isTomorrow);
      } catch (ex) {
        toast(ex.message);
        startBtn.disabled = false;
      }
    }
  }, isTomorrow ? "Plan tomorrow's checklist" : (presets.length ? 'Start checklist' : 'Start blank checklist'));

  root.replaceChildren(
    h('div', { class: 'starter card' },
      h('div', { class: 'starter-emoji' }, isTomorrow ? '🌤️' : '🌅'),
      h('h1', {}, isTomorrow ? 'Plan tomorrow' : 'Start your day'),
      h('p', { class: 'muted' }, prettyDate(date)),
      presets.length
        ? h('div', { class: 'preset-picker' },
            h('p', { class: 'picker-label' }, 'Include these task sets:'),
            presets.map(p => {
              const cb = h('input', {
                type: 'checkbox', checked: true,
                onchange: () => cb.checked ? selected.add(p.id) : selected.delete(p.id)
              });
              return h('label', { class: 'preset-option' },
                cb,
                h('span', {}, p.name),
                h('span', { class: 'muted small count' }, `${p.tasks.length} task${p.tasks.length === 1 ? '' : 's'}`));
            }))
        : h('p', { class: 'muted' }, 'No task sets yet — create reusable sets in Presets, or start blank and add tasks as you go.'),
      h('div', { class: 'row gap' },
        startBtn,
        h('a', { class: 'btn btn-ghost', href: '#/presets' }, presets.length ? 'Manage presets' : 'Create a preset')),
      isTomorrow
        ? h('a', { class: 'plan-link', href: '#/today' }, '← Back to today')
        : h('a', { class: 'plan-link', href: '#/today/tomorrow' }, '🌤️ Plan tomorrow instead →')));
}

// ---- checklist (today, or tomorrow's plan) ----

function dayStats(day) {
  const total = day.tasks.length;
  const done = day.tasks.filter(t => t.completed).length;
  const mins = day.tasks.reduce((s, t) => s + (t.minutes || 0), 0);
  return { total, done, mins };
}

function renderDay(root, day, isTomorrow) {
  const doneEl = h('span', { class: 'primary-stat' });
  const minsEl = h('span');
  const bar = h('div', { class: 'progress-fill' });

  const refresh = () => {
    const s = dayStats(day);
    if (isTomorrow) {
      doneEl.textContent = `${s.total} task${s.total === 1 ? '' : 's'} planned`;
      minsEl.textContent = '';
    } else {
      doneEl.textContent = `${s.done}/${s.total} tasks done`;
      minsEl.textContent = `${fmtMinutes(s.mins)} tracked`;
    }
    bar.style.width = s.total ? `${(s.done / s.total) * 100}%` : '0%';
  };

  const list = h('div', { class: 'task-list' });
  for (const t of day.tasks) list.append(taskRow(day, t, refresh, isTomorrow));
  enableDragReorder(list, day);

  const addInput = h('input', { class: 'input', placeholder: isTomorrow ? 'Add a task for tomorrow…' : 'Add another task…' });
  const addForm = h('form', {
    class: 'add-task row gap',
    onsubmit: async e => {
      e.preventDefault();
      const title = addInput.value.trim();
      if (!title) return;
      const { task } = await api(`/api/days/${day.id}/tasks`, { method: 'POST', body: { title } });
      day.tasks.push(task);
      list.append(taskRow(day, task, refresh, isTomorrow));
      addInput.value = '';
      refresh();
    }
  }, addInput, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Add'));

  const children = [
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, isTomorrow ? "Tomorrow's plan" : 'Today'),
        h('p', { class: 'muted' }, prettyDate(day.date))),
      h('div', { class: 'day-stats' },
        doneEl,
        minsEl,
        isTomorrow
          ? h('a', { class: 'plan-link', href: '#/today' }, '← Back to today')
          : h('a', { class: 'plan-link', href: '#/today/tomorrow' }, '🌤️ Plan tomorrow →'))),
  ];
  if (!isTomorrow) children.push(h('div', { class: 'progress' }, bar));
  children.push(
    h('div', { class: 'card' },
      list,
      day.tasks.length === 0 ? h('p', { class: 'muted', style: 'padding: 4px 6px 10px' }, 'Empty checklist — add your first task below.') : null,
      addForm));

  if (isTomorrow) {
    children.push(h('p', { class: 'muted small' },
      'These tasks will be waiting on your Today page tomorrow morning. Check-offs and timers unlock when the day arrives.'));
  } else {
    const ta = h('textarea', {
      class: 'input reflection-input', rows: 4,
      placeholder: 'How did today go? What went well, what would you change?'
    });
    ta.value = day.reflection || '';
    children.push(
      h('div', { class: 'card reflection' },
        h('h2', {}, '🪞 Daily reflection'),
        h('p', { class: 'muted small' }, 'Wrap up your day with a quick note on how productive you felt.'),
        ta,
        h('div', { class: 'row end' },
          h('button', {
            class: 'btn btn-primary',
            onclick: async () => {
              await api(`/api/days/${day.id}`, { method: 'PATCH', body: { reflection: ta.value } });
              toast('Reflection saved ✓');
            }
          }, 'Save reflection'))));
  }

  root.replaceChildren(h('div', { class: 'page' }, children));
  refresh();
}

// Drag & drop reordering. With a mouse you can grab anywhere on a row that
// isn't a control (checkbox, buttons, inputs); on touch, use the ⠿ handle so
// the list can still scroll. A 5px movement threshold keeps ordinary clicks
// and double-clicks working exactly as before.
function enableDragReorder(list, day) {
  list.addEventListener('pointerdown', e => {
    if (e.button != null && e.button !== 0) return;
    const row = e.target.closest('.task-row');
    if (!row || !list.contains(row)) return;
    if (e.target.closest('input, button, textarea, a, label')) return;
    if (e.pointerType === 'touch' && !e.target.closest('.drag-handle')) return;

    const pid = e.pointerId;
    const startY = e.clientY;
    let active = false;

    const move = ev => {
      if (ev.pointerId !== pid) return;
      if (!active) {
        if (Math.abs(ev.clientY - startY) < 5) return;
        active = true;
        row.classList.add('dragging');
        document.body.classList.add('drag-lock');
      }
      const others = [...list.querySelectorAll('.task-row')].filter(r => r !== row);
      let before = null;
      for (const r of others) {
        const rect = r.getBoundingClientRect();
        if (ev.clientY < rect.top + rect.height / 2) { before = r; break; }
      }
      if (before) list.insertBefore(row, before);
      else list.append(row);
    };

    const finish = ev => {
      if (ev.pointerId !== pid) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.classList.remove('drag-lock');
      if (!active) return; // it was just a click — nothing moved
      row.classList.remove('dragging');
      const ids = [...list.querySelectorAll('.task-row')].map(r => r.dataset.taskId);
      day.tasks.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      api(`/api/days/${day.id}/reorder`, { method: 'POST', body: { taskIds: ids } });
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  });
}

function taskRow(day, task, onChange, isTomorrow) {
  const row = h('div', { class: `task-row${task.completed ? ' done' : ''}`, 'data-task-id': task.id });
  const titleEl = h('span', { class: 'task-title' }, task.title);
  const grip = h('span', { class: 'drag-handle', title: 'Drag to reorder' }, '⠿');

  const startEdit = () => {
    const input = h('input', { class: 'input task-edit', value: task.title });
    let settled = false;
    const commit = async () => {
      if (settled) return;
      settled = true;
      const next = input.value.trim();
      input.replaceWith(titleEl);
      if (next && next !== task.title) {
        task.title = next;
        titleEl.textContent = next;
        await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: { title: next } });
      }
    };
    const cancel = () => {
      if (settled) return;
      settled = true;
      input.replaceWith(titleEl);
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') cancel();
    });
    input.addEventListener('blur', commit);
    titleEl.replaceWith(input);
    input.focus();
    input.select();
  };

  const minutes = h('input', {
    type: 'number', class: 'input minutes-input', min: 0, value: task.minutes || 0,
    onchange: async () => {
      task.minutes = Math.max(0, Math.round(Number(minutes.value) || 0));
      minutes.value = task.minutes;
      onChange();
      await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: { minutes: task.minutes } });
    }
  });

  const del = h('button', {
    class: 'icon-btn danger', title: 'Remove task',
    onclick: async () => {
      if (!(await confirmDialog(`Remove “${task.title}” from this checklist?`, 'Remove'))) return;
      await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
      const running = timers.get(task.id);
      if (running) { clearInterval(running.intervalId); timers.delete(task.id); }
      day.tasks = day.tasks.filter(t => t.id !== task.id);
      row.remove();
      onChange();
    }
  }, '✕');

  const editBtn = h('button', { class: 'icon-btn', title: 'Edit task', onclick: startEdit }, '✏️');
  titleEl.addEventListener('dblclick', startEdit);

  if (isTomorrow) {
    // Planning mode: no check-off, no timer — just the list, times editable.
    row.append(
      grip,
      h('span', { class: 'task-mark' }, '•'),
      titleEl,
      editBtn,
      h('label', { class: 'minutes-wrap' }, minutes, h('span', { class: 'muted small' }, 'min')),
      del);
    return row;
  }

  const cb = h('input', {
    type: 'checkbox', class: 'task-check', checked: task.completed,
    onchange: async () => {
      task.completed = cb.checked;
      row.classList.toggle('done', task.completed);
      onChange();
      await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: { completed: task.completed } });
    }
  });

  const live = h('span', { class: 'timer-live' });
  const timerBtn = h('button', {
    class: 'icon-btn timer-btn', title: 'Start timer',
    onclick: () => toggleTimer(task, timerBtn, minutes, live, row, onChange)
  }, '▶');

  row.append(
    grip,
    cb,
    titleEl,
    live,
    editBtn,
    timerBtn,
    h('label', { class: 'minutes-wrap' }, minutes, h('span', { class: 'muted small' }, 'min')),
    del);
  return row;
}

function toggleTimer(task, btn, minutesInput, live, row, onChange) {
  const running = timers.get(task.id);
  if (running) {
    clearInterval(running.intervalId);
    timers.delete(task.id);
    const sec = Math.round((Date.now() - running.startedAt) / 1000);
    live.textContent = '';
    btn.textContent = '▶';
    btn.title = 'Start timer';
    row.classList.remove('timing');
    const add = Math.max(1, Math.round(sec / 60));
    task.minutes = (task.minutes || 0) + add;
    minutesInput.value = task.minutes;
    onChange();
    api(`/api/tasks/${task.id}`, { method: 'PATCH', body: { minutes: task.minutes } });
    toast(`Logged ${add} min on “${task.title}”`);
  } else {
    const startedAt = Date.now();
    const intervalId = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      live.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 1000);
    timers.set(task.id, { startedAt, intervalId });
    btn.textContent = '⏸';
    btn.title = 'Stop timer and log time';
    row.classList.add('timing');
    live.textContent = '0:00';
  }
}
