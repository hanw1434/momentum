import { api, setToken } from '../api.js';
import { h, toast, confirmDialog } from '../ui.js';
import { getUser, setUser, avatarEl } from '../app.js';

export async function profileView(root) {
  const user = getUser();

  // ---- profile photo ----

  const file = h('input', {
    type: 'file', accept: 'image/*', style: 'display:none',
    onchange: async () => {
      const f = file.files[0];
      if (!f) return;
      try {
        const avatar = await resizeToDataUrl(f, 128);
        const res = await api('/api/profile', { method: 'PATCH', body: { avatar } });
        toast('Profile photo updated ✓');
        setUser(res.user);
      } catch (ex) {
        toast(ex.message);
      }
    }
  });

  const photoButtons = h('div', { class: 'row gap' },
    h('button', { class: 'btn btn-ghost small-btn', onclick: () => file.click() },
      user.avatar ? 'Change photo' : 'Add a photo'),
    user.avatar
      ? h('button', {
          class: 'btn btn-ghost small-btn',
          onclick: async () => {
            if (!(await confirmDialog('Remove your profile photo?', 'Remove'))) return;
            const res = await api('/api/profile', { method: 'PATCH', body: { avatar: '' } });
            toast('Photo removed');
            setUser(res.user);
          }
        }, 'Remove photo')
      : null);

  // ---- email ----

  const emailStatus = user.pendingEmail
    ? h('p', { class: 'small' }, h('span', { class: 'badge' }, '⏳ Pending'),
        ` ${user.pendingEmail} — click the verification link to activate it.`)
    : user.email
      ? h('p', { class: 'small' },
          h('span', { class: 'badge' }, user.emailVerified ? '✓ Verified' : '⏳ Unverified'),
          ` ${user.email}`)
      : h('p', { class: 'muted small' }, 'No email set yet — add one so you can recover your password.');

  const emailInput = h('input', {
    class: 'input', type: 'email', placeholder: 'you@example.com',
    autocomplete: 'email', value: user.pendingEmail || user.email || ''
  });
  const emailMsg = h('p', { class: 'small muted', style: 'min-height:1.2em' });
  const verifyArea = h('div', {});

  const saveEmail = h('button', {
    class: 'btn btn-primary small-btn',
    onclick: async () => {
      emailMsg.textContent = '';
      verifyArea.replaceChildren();
      saveEmail.disabled = true;
      try {
        const res = await api('/api/profile', { method: 'PATCH', body: { email: emailInput.value } });
        emailMsg.textContent = res.message || 'Saved.';
        if (res.devVerifyUrl) {
          const token = res.devVerifyUrl.match(/verify\/([0-9a-f-]{36})/)[1];
          verifyArea.append(h('button', {
            class: 'btn btn-primary small-btn',
            onclick: async () => {
              try {
                const r = await api('/api/auth/verify', { method: 'POST', body: { token } });
                setToken(r.token);
                toast('✅ Email verified!');
                setUser(r.user);
              } catch (ex) {
                toast(ex.message);
              }
            }
          }, '✅ Verify this email now'));
        } else {
          setUser(res.user);
        }
      } catch (ex) {
        emailMsg.textContent = ex.message;
      } finally {
        saveEmail.disabled = false;
      }
    }
  }, 'Save email');

  root.replaceChildren(
    h('div', { class: 'page' },
      h('div', { class: 'page-head' },
        h('div', {},
          h('h1', {}, 'Your profile'),
          h('p', { class: 'muted' }, `Signed in as ${user.username}`))),
      h('div', { class: 'card profile-card' },
        h('div', { class: 'row gap center' },
          avatarEl(user, true),
          h('div', { class: 'form-col' },
            h('h2', {}, user.username),
            photoButtons,
            file))),
      h('div', { class: 'card profile-card' },
        h('h2', {}, '📧 Email'),
        h('p', { class: 'muted small' }, 'Used for password recovery. Changing it sends a verification link; the new address only takes over once verified.'),
        emailStatus,
        h('div', { class: 'row gap' }, emailInput, saveEmail),
        emailMsg,
        verifyArea),
      h('div', { class: 'card profile-card' },
        h('h2', {}, '🔑 Password'),
        h('p', { class: 'muted small' }, 'To change your password, log out and use “Forgot password?” on the sign-in screen — a reset link goes to your verified email.'))));
}

function resizeToDataUrl(f, size) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      const s = Math.min(im.width, im.height);
      ctx.drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    im.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image file'));
    };
    im.src = url;
  });
}
