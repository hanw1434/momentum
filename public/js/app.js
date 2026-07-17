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
  try { serverConfig = await api('/api/config'); } catch { /* google button falls back to explainer */ }

  // Email verification links look like /#/verify/<token>.
  const vm = location.hash.match(/^#\/verify\/([0-9a-f-]{36})$/);
  if (vm && !getToken()) {
    history.replaceState(null, '', '#/today');
    try {
      const res = await api('/api/auth/verify', { method: 'POST', body: { token: vm[1] } });
      setToken(res.token);
      user = res.user;
      renderShell();
      toast('✅ Email verified — welcome to Momentum!');
      return;
    } catch (ex) {
      renderAuth(ex.message);
      return;
    }
  }

  if (getToken()) {
    try { ({ user } = await api('/api/me')); } catch { clearToken(); }
  }
  user ? renderShell() : renderAuth();
}

// ---------------- auth screen ----------------

const G_LOGO_SVG = '<svg viewBox="0 0 48 48" width="18" height="18"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

function captchaWidget() {
  const img = h('div', { class: 'captcha-img' });
  const answer = h('input', {
    class: 'input', placeholder: 'Type the characters above',
    autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false'
  });
  let id = null;
  async function refresh() {
    answer.value = '';
    img.textContent = '…';
    try {
      const d = await api('/api/captcha');
      id = d.captchaId;
      img.innerHTML = d.svg;
    } catch {
      img.textContent = 'Could not load captcha — retry';
    }
  }
  refresh();
  const el = h('div', { class: 'captcha-box' },
    h('div', { class: 'captcha-row' },
      img,
      h('button', { class: 'icon-btn', type: 'button', title: 'New characters', onclick: refresh }, '↻')),
    answer);
  return { el, refresh, get id() { return id; }, get answer() { return answer.value; } };
}

function renderAuth(initialError = '') {
  let mode = 'login';
  const err = h('p', { class: 'form-error' }, initialError);
  const username = h('input', { class: 'input', placeholder: 'Username', autocomplete: 'username', required: true });
  const email = h('input', { class: 'input', type: 'email', placeholder: 'Email address', autocomplete: 'email' });
  const emailWrap = h('div', { style: 'display:none' }, email);
  const password = h('input', { class: 'input', type: 'password', placeholder: 'Password', autocomplete: 'current-password', required: true });
  const captcha = captchaWidget();
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Sign in');
  const resendBtn = h('button', {
    class: 'btn btn-ghost small-btn', type: 'button', style: 'display:none',
    onclick: async () => {
      err.textContent = '';
      if (!captcha.answer.trim()) {
        err.textContent = 'Fill in the (new) captcha first, then press resend.';
        return;
      }
      try {
        const res = await api('/api/auth/resend', {
          method: 'POST',
          body: { identifier: username.value, captchaId: captcha.id, captchaAnswer: captcha.answer }
        });
        showPending(res);
      } catch (ex) {
        err.textContent = ex.message;
        captcha.refresh();
      }
    }
  }, '📮 Resend verification email');

  const tabs = ['login', 'register'].map(m =>
    h('button', {
      class: `auth-tab${m === mode ? ' active' : ''}`, type: 'button',
      onclick: e => {
        mode = m;
        err.textContent = '';
        resendBtn.style.display = 'none';
        emailWrap.style.display = m === 'register' ? '' : 'none';
        email.required = m === 'register';
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
        const body = { username: username.value, password: password.value, captchaId: captcha.id, captchaAnswer: captcha.answer };
        if (mode === 'register') body.email = email.value;
        const res = await api(`/api/auth/${mode}`, { method: 'POST', body });
        if (res.needsVerification) {
          showPending(res);
          return;
        }
        setToken(res.token);
        user = res.user;
        renderShell();
      } catch (ex) {
        err.textContent = ex.message;
        captcha.refresh(); // captchas are single-use — always issue a fresh one
        if (/verify your email/i.test(ex.message)) resendBtn.style.display = '';
      } finally {
        submit.disabled = false;
      }
    }
  }, username, emailWrap, password, captcha.el, err, submit, resendBtn);

  // Google entry point is always visible; unconfigured servers explain what's missing.
  const gWrap = h('div', { class: 'gsi-holder' });
  if (serverConfig.googleClientId) {
    mountGoogleButton(gWrap, err);
  } else {
    const gLogo = h('span', { class: 'g-logo' });
    gLogo.innerHTML = G_LOGO_SVG;
    gWrap.append(h('button', {
      class: 'btn btn-ghost google-btn', type: 'button',
      onclick: () => {
        err.textContent = "Google sign-in isn't active on this server yet — it needs a free Google OAuth client ID (see README → “Google sign-in”). Password sign-up works right away.";
      }
    }, gLogo, 'Continue with Google'));
  }

  const card = h('div', { class: 'card auth-card' },
    h('div', { class: 'auth-hero' },
      h('div', { class: 'brand-logo' }, 'M'),
      h('h1', {}, 'Momentum'),
      h('p', { class: 'tagline' }, 'Daily checklists, goals & reminders — your day, on track.')),
    h('div', { class: 'auth-tabs' }, tabs),
    form,
    h('div', { class: 'divider' }, 'or'),
    gWrap);

  function showPending(res) {
    const bits = [
      h('div', { class: 'auth-hero' },
        h('span', { class: 'starter-emoji' }, '📬'),
        h('h1', {}, 'Verify your email'),
        h('p', { class: 'tagline' }, res.message))
    ];
    if (res.devVerifyUrl) {
      const tokenMatch = res.devVerifyUrl.match(/verify\/([0-9a-f-]{36})/);
      bits.push(h('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          try {
            const r = await api('/api/auth/verify', { method: 'POST', body: { token: tokenMatch[1] } });
            setToken(r.token);
            user = r.user;
            renderShell();
            toast('✅ Email verified — welcome to Momentum!');
          } catch (ex) {
            toast(ex.message);
          }
        }
      }, '✅ Verify my email'));
    }
    bits.push(h('button', { class: 'btn btn-ghost', onclick: () => renderAuth() }, '← Back to sign in'));
    card.replaceChildren(...bits);
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
