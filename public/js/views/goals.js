import { api } from '../api.js';
import { h, modal, confirmDialog, shortDate } from '../ui.js';

export async function goalsView(root) {
  const { goals } = await api('/api/goals');
  const refresh = () => goalsView(root);
  const active = goals.filter(g => !g.completed);
  const done = goals.filter(g => g.completed);

  root.replaceChildren(
    h('div', { class: 'page' },
      h('div', { class: 'page-head' },
        h('div', {},
          h('h1', {}, 'Goals'),
          h('p', { class: 'muted' }, 'Longer-term targets to keep in sight.')),
        h('button', { class: 'btn btn-primary', onclick: () => goalModal(null, refresh) }, '+ New goal')),
      goals.length === 0
        ? h('div', { class: 'empty-state card' },
            h('span', { class: 'big' }, '🎯'),
            h('p', {}, 'No goals yet. Add something you’re working toward.'))
        : [
            active.map(g => goalCard(g, refresh)),
            done.length ? h('p', { class: 'section-label' }, `Completed (${done.length})`) : null,
            done.map(g => goalCard(g, refresh)),
          ]));
}

function daysLeftChip(goal) {
  if (!goal.targetDate) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(goal.targetDate + 'T00:00') - today) / 86400000);
  let label;
  if (goal.completed) label = `🏁 ${shortDate(goal.targetDate)}`;
  else if (diff > 1) label = `📆 ${shortDate(goal.targetDate)} · ${diff} days left`;
  else if (diff === 1) label = '📆 Due tomorrow';
  else if (diff === 0) label = '📆 Due today';
  else label = `⚠️ ${-diff} day${diff === -1 ? '' : 's'} overdue`;
  return h('span', { class: `target-chip${!goal.completed && diff < 0 ? ' overdue' : ''}` }, label);
}

function goalCard(goal, refresh) {
  const cb = h('input', {
    type: 'checkbox', class: 'goal-check', checked: goal.completed, title: goal.completed ? 'Reopen goal' : 'Mark complete',
    onchange: async () => {
      await api(`/api/goals/${goal.id}`, { method: 'PATCH', body: { completed: cb.checked } });
      refresh();
    }
  });
  return h('div', { class: `card goal-card${goal.completed ? ' completed' : ''}` },
    cb,
    h('div', { class: 'goal-body' },
      h('span', { class: 'goal-title' }, goal.title),
      goal.description ? h('p', { class: 'goal-desc' }, goal.description) : null,
      daysLeftChip(goal)),
    h('div', { class: 'goal-actions' },
      h('button', { class: 'icon-btn', title: 'Edit goal', onclick: () => goalModal(goal, refresh) }, '✏️'),
      h('button', {
        class: 'icon-btn danger', title: 'Delete goal',
        onclick: async () => {
          if (!(await confirmDialog(`Delete goal “${goal.title}”?`))) return;
          await api(`/api/goals/${goal.id}`, { method: 'DELETE' });
          refresh();
        }
      }, '✕')));
}

function goalModal(goal, onSaved) {
  const isNew = !goal;
  const title = h('input', { class: 'input', placeholder: 'What do you want to achieve?', value: goal?.title || '' });
  const desc = h('textarea', { class: 'input', rows: 3, placeholder: 'Details (optional)' });
  desc.value = goal?.description || '';
  const target = h('input', { class: 'input', type: 'date', value: goal?.targetDate || '' });
  const err = h('p', { class: 'form-error' });

  const m = modal(isNew ? 'New goal' : 'Edit goal',
    h('div', { class: 'form-col' },
      title,
      desc,
      h('label', { class: 'small muted' }, 'Target date (optional)', target),
      err,
      h('div', { class: 'row gap end' },
        h('button', {
          class: 'btn btn-primary',
          onclick: async () => {
            if (!title.value.trim()) { err.textContent = 'Give the goal a title.'; return; }
            try {
              await api(isNew ? '/api/goals' : `/api/goals/${goal.id}`, {
                method: isNew ? 'POST' : 'PATCH',
                body: { title: title.value, description: desc.value, targetDate: target.value }
              });
              m.close();
              onSaved();
            } catch (ex) {
              err.textContent = ex.message;
            }
          }
        }, isNew ? 'Add goal' : 'Save changes'))));
  title.focus();
}
