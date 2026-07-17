import { api, getToken, setToken, clearToken } from './api.js';
import { h, toast, fmtLead, fmtTime } from './ui.js';
import { todayView } from './views/today.js';
import { calendarView } from './views/calendar.js';
import { archiveView } from './views/archive.js';
import { goalsView } from './views/goals.js';
import { bulletinView } from './views/bulletin.js';
import { presetsView } from './views/presets.js';

const NAV = [
  { id: 'today', emoji: '☀️', label: 'Today', view: todayView },
  { id: 'calendar', emoji: '📅', label: 'Calendar', view: calendarView },
  { id: 'archive', emoji: '📚', label: 'Archive', view: archiveView },
  { id: 'goals', emoji: '🎯', label: 'Goals', view: goalsView },
  { id: 'bulletin', emoji: '📌', label: 'Bulletin', view: bulletinView },
  { id: 'presets', emoji: '📋', label: 'Presets', view: presetsView },
];

const root = document.getElementById('app');
let user = null;
let main = null;
let navLinks = [];
let serverConfig = { googleClientId: '' };

// ---------------- theme ----------------
// No stored preference = follow the system. The toggle forces light/dark
// and persists the choice.

const THEME_KEY = 'momentum_theme';

function applyTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') {
    document.documentElement.dataset.theme = saved;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

function effectiveTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function themeButton() {
  const btn = h('button', { class: 'icon-btn', onclick: () => {
    localStorage.setItem(THEME_KEY, effectiveTheme() === 'dark' ? 'light' : 'dark');
    applyTheme();
    update();
  } });
  const update = () => {
    const dark = effectiveTheme() === 'dark';
    btn.textContent = dark ? '☀️' : '🌙';
    btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
  };
  update();
  return btn;
}

// ---------------- boot ----------------

async function boot() {
  applyTheme();
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('/sw.js'); } catch { /* offline support optional */ }
  }
  try { serverConfig = await api('/api/config'); } catch { /* google button just stays hidden */ }
  if (getToken()) {
    try { ({ user } = await api('/api/me')); } catch { clearToken(); }
  }
  user ? renderShell() : renderAuth();
}

// ---------------- auth screen ----------------

function renderAuth() {
  let mode = 'login';
  const err = h('p', { class: 'form-error' });
  const username = h('input', { class: 'input', placeholder: 'Username', autocomplete: 'username', required: true });
  const password = h('input', { class: 'input', type: 'password', placeholder: 'Password', autocomplete: 'current-password', required: true });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Sign in');

  const tabs = ['login', 'register'].map(m =>
    h('button', {
      class: `auth-tab${m === mode ? ' active' : ''}`, type: 'button',
      onclick: e => {
        mode = m;
        err.textContent = '';
        submit.textContent = m === 'login' ? 'Sign in' : 'Create account';
        tabs.forEach(t => t.classList.toggle('active', t === e.currentTarget));
      }
    }, m === 'login' ? 'Sign in' : 'Sign up'));

  const form = h('form', {
    class: 'form-col',
    onsubmit: async e => {
      e.preventDefault();
      err.textContent = '';
      submit.disabled = true;
      try {
        const res = await api(`/api/auth/${mode}`, { method: 'POST', body: { username: username.value, password: password.value } });
        setToken(res.token);
        user = res.user;
        renderShell();
      } catch (ex) {
        err.textContent = ex.message;
      } finally {
        submit.disabled = false;
      }
    }
  }, username, password, err, submit);

  const card = h('div', { class: 'card auth-card' },
    h('div', { class: 'auth-hero' },
      h('div', { class: 'brand-logo' }, 'M'),
      h('h1', {}, 'Momentum'),
      h('p', { class: 'tagline' }, 'Daily checklists, goals & reminders — your day, on track.')),
    h('div', { class: 'auth-tabs' }, tabs),
    form);

  if (serverConfig.googleClientId) {
    const holder = h('div', { class: 'gsi-holder' });
    card.append(h('div', { class: 'divider' }, 'or'), holder);
    mountGoogleButton(holder, err);
  }

  root.replaceChildren(h('div', { class: 'auth-wrap' }, card));
}

let gisLoading = null;
function loadGis() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = resolve;
      s.onerror = () => { gisLoading = null; reject(new Error('Could not load Google sign-in')); };
      document.head.append(s);
    });
  }
  return gisLoading;
}

async function mountGoogleButton(holder, err) {
  try {
    await loadGis();
    window.google.accounts.id.initialize({
      client_id: serverConfig.googleClientId,
      callback: async resp => {
        try {
          const res = await api('/api/auth/google', { method: 'POST', body: { credential: resp.credential } });
          setToken(res.token);
          user = res.user;
          renderShell();
        } catch (ex) {
          err.textContent = ex.message;
        }
      }
    });
    window.google.accounts.id.renderButton(holder, { theme: 'outline', size: 'large', shape: 'pill', width: 280 });
  } catch (ex) {
    err.textContent = ex.message;
  }
}

// ---------------- app shell ----------------

function renderShell() {
  main = h('main', { class: 'main' });
  navLinks = NAV.map(n =>
    h('a', { class: 'nav-link', href: `#/${n.id}` },
      h('span', { class: 'nav-emoji' }, n.emoji),
      h('span', { class: 'nav-label' }, n.label)));

  const sidebar = h('aside', { class: 'sidebar' },
    h('div', { class: 'brand' },
      h('div', { class: 'brand-logo' }, 'M'),
      h('span', { class: 'brand-name' }, 'Momentum')),
    h('nav', { class: 'nav' }, navLinks),
    h('div', { class: 'sidebar-spacer' }),
    notifBanner(),
    h('div', { class: 'userbox' },
      h('div', { class: 'avatar' }, user.username[0]),
      h('span', { class: 'username' }, user.username),
      themeButton(),
      h('button', {
        class: 'icon-btn', title: 'Log out',
        onclick: () => { location.hash = '#/logout'; }
      }, '🚪')));

  root.replaceChildren(h('div', { class: 'shell' }, sidebar, main));
  startReminders();
  if (!location.hash || location.hash === '#' || location.hash === '#/logout') location.hash = '#/today';
  route();
}

function notifBanner() {
  if (!('Notification' in window) || Notification.permission !== 'default') return null;
  const banner = h('div', { class: 'notif-banner' },
    h('span', {}, '🔔 Get pop-up reminders for your calendar events.'),
    h('button', {
      class: 'btn btn-primary small-btn',
      onclick: async () => {
        await Notification.requestPermission();
        banner.remove();
      }
    }, 'Enable notifications'));
  return banner;
}

window.addEventListener('hashchange', () => { if (user) route(); });

function route() {
  const parts = location.hash.split('/'); // '#/archive/2026-07-16' -> ['#', 'archive', '2026-07-16']
  if (parts[1] === 'logout') return renderLogoutPage();
  const entry = NAV.find(n => n.id === parts[1]) || NAV[0];
  navLinks.forEach((link, i) => link.classList.toggle('active', NAV[i] === entry));
  main.scrollTop = 0;
  entry.view(main, parts[2]).catch(ex => {
    main.replaceChildren(h('div', { class: 'empty-state' },
      h('span', { class: 'big' }, '😕'),
      h('p', {}, `Couldn't load this page: ${ex.message}`)));
  });
}

function renderLogoutPage() {
  navLinks.forEach(link => link.classList.remove('active'));
  main.replaceChildren(
    h('div', { class: 'card logout-page' },
      h('span', { class: 'big' }, '🚪'),
      h('h1', {}, 'Log out of Momentum?'),
      h('p', { class: 'muted' }, `You're signed in as ${user.username}. Your checklists, goals and events stay safely on this server — sign back in any time.`),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn btn-ghost', onclick: () => { location.hash = '#/today'; } }, 'Cancel'),
        h('button', {
          class: 'btn btn-primary',
          onclick: () => {
            clearToken();
            location.hash = '';
            location.reload();
          }
        }, 'Log out'))));
}

// ---------------- reminder engine ----------------
// Checks calendar events every 20s and fires a system notification (if allowed)
// plus an in-app toast at each configured lead time while the app is open.

let events = [];
let firedKey = null;
let fired = new Set();

async function loadEvents() {
  try { ({ events } = await api('/api/events')); } catch { /* keep last known */ }
}

function loadFired() {
  firedKey = `momentum_fired_${user.id}`;
  try { fired = new Set(JSON.parse(localStorage.getItem(firedKey) || '[]')); } catch { fired = new Set(); }
}

function persistFired() {
  localStorage.setItem(firedKey, JSON.stringify([...fired].slice(-500)));
}

function checkReminders() {
  const now = Date.now();
  for (const e of events) {
    const start = new Date(`${e.date}T${e.time}`).getTime();
    if (Number.isNaN(start)) continue;
    for (const lead of e.reminders || []) {
      const at = start - lead * 60000;
      const key = `${e.id}:${lead}`;
      // Fire if the lead time has passed but the event is still upcoming (grace: 1 min after start).
      if (at <= now && now <= start + 60000 && !fired.has(key)) {
        fired.add(key);
        persistFired();
        fireReminder(e, lead);
      }
    }
  }
}

function fireReminder(event, lead) {
  const when = lead === 0 ? 'Starting now' : `In ${fmtLead(lead)} (at ${fmtTime(event.time)})`;
  const body = event.description ? `${when} — ${event.description}` : when;
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(`⏰ ${event.title}`, { body, icon: '/icons/icon-180.png' }); } catch { /* toast still shows */ }
  }
  toast(`⏰ ${event.title} — ${when}`, 'reminder');
}

let remindersStarted = false;
function startReminders() {
  if (remindersStarted) return;
  remindersStarted = true;
  loadFired();
  loadEvents().then(checkReminders);
  setInterval(checkReminders, 20000);
  setInterval(loadEvents, 5 * 60000);
  window.addEventListener('events-changed', loadEvents);
}

boot();
