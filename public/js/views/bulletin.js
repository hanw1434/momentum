import { api } from '../api.js';
import { h, modal, confirmDialog } from '../ui.js';

const COLORS = ['#fff9c4', '#c8e6ff', '#d3f5d8', '#ffd9ec', '#e6ddff'];

export async function bulletinView(root) {
  const { notes } = await api('/api/notes');
  const refresh = () => bulletinView(root);

  root.replaceChildren(
    h('div', { class: 'page' },
      h('div', { class: 'page-head' },
        h('div', {},
          h('h1', {}, 'Bulletin board'),
          h('p', { class: 'muted' }, 'Pin ideas, links and things to keep in mind.')),
        h('button', { class: 'btn btn-primary', onclick: () => noteModal(null, refresh) }, '+ New note')),
      notes.length === 0
        ? h('div', { class: 'empty-state card' },
            h('span', { class: 'big' }, '📌'),
            h('p', {}, 'The board is empty. Pin your first note!'))
        : h('div', { class: 'notes-grid' },
            [...notes].reverse().map(note =>
              h('div', { class: 'note', style: `background:${COLORS.includes(note.color) ? note.color : COLORS[0]}` },
                h('p', { class: 'note-content' }, note.content),
                h('div', { class: 'note-foot' },
                  h('span', {}, new Date(note.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
                  h('div', { class: 'row' },
                    h('button', { class: 'icon-btn', title: 'Edit note', onclick: () => noteModal(note, refresh) }, '✏️'),
                    h('button', {
                      class: 'icon-btn', title: 'Delete note',
                      onclick: async () => {
                        if (!(await confirmDialog('Take this note off the board?'))) return;
                        await api(`/api/notes/${note.id}`, { method: 'DELETE' });
                        refresh();
                      }
                    }, '✕'))))))));
}

function noteModal(note, onSaved) {
  const isNew = !note;
  let color = note?.color && COLORS.includes(note.color) ? note.color : COLORS[0];
  const content = h('textarea', { class: 'input', rows: 5, placeholder: 'Write your note…' });
  content.value = note?.content || '';
  const err = h('p', { class: 'form-error' });

  const swatches = COLORS.map(c => {
    const b = h('button', {
      class: `swatch${c === color ? ' selected' : ''}`, style: `background:${c}`, 'aria-label': `Color ${c}`,
      onclick: () => {
        color = c;
        swatches.forEach(s => s.classList.toggle('selected', s === b));
      }
    });
    return b;
  });

  const m = modal(isNew ? 'New note' : 'Edit note',
    h('div', { class: 'form-col' },
      content,
      h('div', { class: 'swatches' }, swatches),
      err,
      h('div', { class: 'row gap end' },
        h('button', {
          class: 'btn btn-primary',
          onclick: async () => {
            if (!content.value.trim()) { err.textContent = 'The note is empty.'; return; }
            try {
              await api(isNew ? '/api/notes' : `/api/notes/${note.id}`, {
                method: isNew ? 'POST' : 'PATCH',
                body: { content: content.value, color }
              });
              m.close();
              onSaved();
            } catch (ex) {
              err.textContent = ex.message;
            }
          }
        }, isNew ? 'Pin to board' : 'Save changes'))));
  content.focus();
}
