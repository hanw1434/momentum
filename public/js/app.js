import { api, getToken, setToken, clearToken } from './api.js';
import { h, toast, fmtLead, fmtTime } from './ui.js';
import { todayView } from './views/today.js';
import { calendarView } from './views/calendar.js';
import { archiveView } from './views/archive.js';
import { goalsView } from './views/goals.js';
import { bulletinView } from './views/bulletin.js';
import { presetsView } from './views/presets.js';
import { profileView } from './views/profile.js';

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

// Views (e.g. Profile) read and update the signed-in user through these.
export function getUser() { return user; }
export function setUser(u) {
  user = u;
  renderShell();
}

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
  // Password reset links look like /#/reset/<token>.
  const rm = location.hash.match(/^#\/reset\/([0-9a-f-]{36})$/);
  if (rm) {
    renderResetForm(rm[1]);
    return;
  }

  // Email verification links look like /#/verify/<token>.
  const vm = location.hash.match(/^#\/verify\/([0-9a-f-]{36})$/);
  if (vm) {
    history.replaceState(null, '', '#/today');
    try {
      const res = await api('/api/auth/verify', { method: 'POST', body: { token: vm[1] } });
      setToken(res.token);
      user = res.user;
      renderShell();
      toast('✅ Email verified!');
      return;
    } catch (ex) {
      if (!getToken()) {
        renderAuth(ex.message);
        return;
      }
    }
  }

  if (getToken()) {
    try { ({ user } = await api('/api/me')); } catch { clearToken(); }
  }
  user ? renderShell() : renderAuth();
}

// ---------------- auth screen ----------------

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
    img.onclick = null;
    try {
      const d = await api('/api/captcha');
      id = d.captchaId;
      img.innerHTML = d.svg;
    } catch (ex) {
      // A 404 here means the backend predates the captcha feature.
      img.textContent = /not found/i.test(ex.message)
        ? '⚠️ Captcha unavailable: the server is running outdated code. Reload/restart the server, then tap here to retry.'
        : `⚠️ Could not load captcha (${ex.message}) — tap to retry.`;
      img.onclick = refresh;
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

  const forgotLink = h('button', {
    class: 'linklike', type: 'button',
    onclick: () => renderForgot()
  }, 'Forgot password?');

  const card = h('div', { class: 'card auth-card' },
    h('div', { class: 'auth-hero' },
      h('div', { class: 'brand-logo' }, 'M'),
      h('h1', {}, 'Momentum'),
      h('p', { class: 'tagline' }, 'Daily checklists, goals & reminders — your day, on track.')),
    h('div', { class: 'auth-tabs' }, tabs),
    form,
    forgotLink);

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

// ---------------- forgot / reset password ----------------

function renderForgot() {
  const err = h('p', { class: 'form-error' });
  const ident = h('input', { class: 'input', placeholder: 'Username or email', autocomplete: 'username', required: true });
  const captcha = captchaWidget();
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Send reset link');

  const card = h('div', { class: 'card auth-card' },
    h('div', { class: 'auth-hero' },
      h('span', { class: 'starter-emoji' }, '🔑'),
      h('h1', {}, 'Reset password'),
      h('p', { class: 'tagline' }, "Enter your username or email and we'll send a reset link to the email on your account.")),
    h('form', {
      class: 'form-col',
      onsubmit: async e => {
        e.preventDefault();
        err.textContent = '';
        submit.disabled = true;
        try {
          const res = await api('/api/auth/forgot', {
            method: 'POST',
            body: { identifier: ident.value, captchaId: captcha.id, captchaAnswer: captcha.answer }
          });
          card.replaceChildren(
            h('div', { class: 'auth-hero' },
              h('span', { class: 'starter-emoji' }, '📮'),
              h('h1', {}, 'Check your email'),
              h('p', { class: 'tagline' }, res.message)),
            h('button', { class: 'btn btn-ghost', onclick: () => renderAuth() }, '← Back to sign in'));
        } catch (ex) {
          err.textContent = ex.message;
          captcha.refresh();
        } finally {
          submit.disabled = false;
        }
      }
    }, ident, captcha.el, err, submit),
    h('button', { class: 'linklike', type: 'button', onclick: () => renderAuth() }, '← Back to sign in'));

  root.replaceChildren(h('div', { class: 'auth-wrap' }, card));
}

function renderResetForm(token) {
  const err = h('p', { class: 'form-error' });
  const pw1 = h('input', { class: 'input', type: 'password', placeholder: 'New password (min 6 characters)', autocomplete: 'new-password', required: true });
  const pw2 = h('input', { class: 'input', type: 'password', placeholder: 'Repeat new password', autocomplete: 'new-password', required: true });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Set new password');

  root.replaceChildren(
    h('div', { class: 'auth-wrap' },
      h('div', { class: 'card auth-card' },
        h('div', { class: 'auth-hero' },
          h('span', { class: 'starter-emoji' }, '🔑'),
          h('h1', {}, 'Choose a new password')),
        h('form', {
          class: 'form-col',
          onsubmit: async e => {
            e.preventDefault();
            err.textContent = '';
            if (pw1.value !== pw2.value) {
              err.textContent = "Those passwords don't match.";
              return;
            }
            submit.disabled = true;
            try {
              const res = await api('/api/auth/reset', { method: 'POST', body: { token, password: pw1.value } });
              setToken(res.token);
              user = res.user;
              history.replaceState(null, '', '#/today');
              renderShell();
              toast('✅ Password updated — you are signed in.');
            } catch (ex) {
              err.textContent = ex.message;
            } finally {
              submit.disabled = false;
            }
          }
        }, pw1, pw2, err, submit),
        h('button', { class: 'linklike', type: 'button', onclick: () => { history.replaceState(null, '', '#/today'); renderAuth(); } }, '← Back to sign in'))));
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
      h('a', { class: 'userbox-link', href: '#/profile', title: 'Open your profile' },
        avatarEl(user),
        h('span', { class: 'username' }, user.username)),
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

// Shared avatar renderer: photo if set, first letter otherwise.
export function avatarEl(u, big = false) {
  const el = h('div', { class: `avatar${big ? ' avatar-big' : ''}` });
  if (u.avatar) {
    el.append(h('img', { src: u.avatar, alt: '' }));
  } else {
    el.textContent = u.username[0];
  }
  return el;
}

function route() {
  const parts = location.hash.split('/'); // '#/archive/2026-07-16' -> ['#', 'archive', '2026-07-16']
  if (parts[1] === 'logout') return renderLogoutPage();
  const showError = ex => {
    main.replaceChildren(h('div', { class: 'empty-state' },
      h('span', { class: 'big' }, '😕'),
      h('p', {}, `Couldn't load this page: ${ex.message}`)));
  };
  if (parts[1] === 'profile') {
    navLinks.forEach(link => link.classList.remove('active'));
    main.scrollTop = 0;
    profileView(main).catch(showError);
    return;
  }
  const entry = NAV.find(n => n.id === parts[1]) || NAV[0];
  navLinks.forEach((link, i) => link.classList.toggle('active', NAV[i] === entry));
  main.scrollTop = 0;
  entry.view(main, parts[2]).catch(showError);
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
