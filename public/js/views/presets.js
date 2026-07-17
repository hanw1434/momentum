import { api } from '../api.js';
import { h, modal, confirmDialog } from '../ui.js';

export async function presetsView(root) {
  const { presets } = await api('/api/presets');
  const refresh = () => presetsView(root);

  root.replaceChildren(
    h('div', { class: 'page' },
      h('div', { class: 'page-head' },
        h('div', {},
          h('h1', {}, 'Presets'),
          h('p', { class: 'muted' }, 'Reusable task sets you can load into any day’s checklist.')),
        h('button', { class: 'btn btn-primary', onclick: () => presetModal(null, refresh) }, '+ New preset')),
      presets.length === 0
        ? h('div', { class: 'empty-state card' },
            h('span', { class: 'big' }, '📋'),
            h('p', {}, 'No presets yet. Create one — like “Morning routine” or “Deep work day” — and it’ll be offered every time you start a new day.'))
        : h('div', { class: 'presets-grid' },
            presets.map(p =>
              h('div', { class: 'card preset-card' },
                h('div', { class: 'head-row' },
                  h('h2', {}, p.name),
                  h('div', { class: 'row' },
                    h('button', { class: 'icon-btn', title: 'Edit preset', onclick: () => presetModal(p, refresh) }, '✏️'),
                    h('button', {
                      class: 'icon-btn danger', title: 'Delete preset',
                      onclick: async () => {
                        if (!(await confirmDialog(`Delete preset “${p.name}”? Days already started keep their tasks.`))) return;
                        await api(`/api/presets/${p.id}`, { method: 'DELETE' });
                        refresh();
                      }
                    }, '✕'))),
                h('ul', { class: 'preset-tasks' },
                  p.tasks.slice(0, 6).map(t => h('li', {}, t.title)),
                  p.tasks.length > 6 ? h('li', {}, `…and ${p.tasks.length - 6} more`) : null,
                  p.tasks.length === 0 ? h('li', { class: 'muted' }, 'No tasks in this set yet') : null))))));
}

function presetModal(preset, onSaved) {
  const isNew = !preset;
  const name = h('input', { class: 'input', placeholder: 'Preset name (e.g. Morning routine)', value: preset?.name || '' });
  const err = h('p', { class: 'form-error' });
  const tasksBox = h('div', { class: 'form-col' });

  function addRow(title = '') {
    const input = h('input', { class: 'input', placeholder: 'Task title', value: title });
    const row = h('div', { class: 'preset-task-row' },
      input,
      h('button', { class: 'icon-btn danger', title: 'Remove task', onclick: () => row.remove() }, '✕'));
    tasksBox.append(row);
    return input;
  }

  (preset?.tasks?.length ? preset.tasks : [{ title: '' }]).forEach(t => addRow(t.title));

  const m = modal(isNew ? 'New preset' : 'Edit preset',
    h('div', { class: 'form-col' },
      name,
      h('p', { class: 'picker-label' }, 'Tasks in this set'),
      tasksBox,
      h('button', { class: 'btn btn-ghost small-btn', style: 'align-self:flex-start', onclick: () => addRow().focus() }, '+ Add task'),
      err,
      h('div', { class: 'row gap end' },
        h('button', {
          class: 'btn btn-primary',
          onclick: async () => {
            if (!name.value.trim()) { err.textContent = 'Give the preset a name.'; return; }
            const tasks = [...tasksBox.querySelectorAll('input')]
              .map(i => i.value.trim())
              .filter(Boolean);
            try {
              await api(isNew ? '/api/presets' : `/api/presets/${preset.id}`, {
                method: isNew ? 'POST' : 'PATCH',
                body: { name: name.value, tasks }
              });
              m.close();
              onSaved();
            } catch (ex) {
              err.textContent = ex.message;
            }
          }
        }, isNew ? 'Create preset' : 'Save changes'))));
  name.focus();
}
