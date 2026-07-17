// Tiny DOM helpers shared by all views.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = true;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
}

let toastBox = null;
export function toast(msg, kind = 'info') {
  if (!toastBox) {
    toastBox = h('div', { class: 'toasts' });
    document.body.append(toastBox);
  }
  const t = h('div', { class: `toast toast-${kind}` }, msg);
  toastBox.append(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 350);
  }, kind === 'reminder' ? 9000 : 3200);
}

export function modal(title, body, opts = {}) {
  const overlay = h('div', { class: 'modal-overlay' });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    opts.onClose?.();
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  const card = h('div', { class: 'modal card' },
    h('div', { class: 'modal-head' },
      h('h2', {}, title),
      h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '✕')),
    body);
  overlay.append(card);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  return { close, overlay };
}

export function confirmDialog(message, action = 'Delete') {
  return new Promise(resolve => {
    const body = h('div', {},
      h('p', { class: 'confirm-msg' }, message),
      h('div', { class: 'row gap end' },
        h('button', { class: 'btn btn-ghost', onclick: () => { m.close(); resolve(false); } }, 'Cancel'),
        h('button', { class: 'btn btn-danger', onclick: () => { resolve(true); m.close(); } }, action)));
    const m = modal('Are you sure?', body, { onClose: () => resolve(false) });
  });
}

// ---- date & time formatting ----

export function localDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function prettyDate(iso) {
  const d = new Date(iso + 'T00:00');
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export function shortDate(iso) {
  const d = new Date(iso + 'T00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtMinutes(min) {
  min = Math.round(min || 0);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
}

export function fmtTime(hhmm) {
  const [hh, mm] = hhmm.split(':').map(Number);
  const ap = hh >= 12 ? 'PM' : 'AM';
  const h12 = ((hh + 11) % 12) + 1;
  return `${h12}:${String(mm).padStart(2, '0')} ${ap}`;
}

export function fmtLead(min) {
  if (min === 0) return 'now';
  if (min % 1440 === 0) { const d = min / 1440; return d === 1 ? '1 day' : `${d} days`; }
  if (min % 60 === 0) { const hr = min / 60; return hr === 1 ? '1 hour' : `${hr} hours`; }
  return `${min} minutes`;
}
