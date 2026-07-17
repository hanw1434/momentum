#!/usr/bin/env python3
"""Momentum - personal productivity tracker. Pure-stdlib backend: no dependencies."""
import json
import os
import random
import re
import hmac
import hashlib
import secrets
import smtplib
import threading
import time
import uuid
import urllib.request
import urllib.parse
from email.message import EmailMessage
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(ROOT, 'public')
DATA_DIR = os.path.join(ROOT, 'data')
DB_PATH = os.path.join(DATA_DIR, 'db.json')
SECRET_PATH = os.path.join(DATA_DIR, 'secret.key')
PORT = int(os.environ.get('PORT', 4000))

EMPTY = {"users": [], "days": [], "tasks": [], "presets": [], "notes": [], "goals": [], "events": []}

os.makedirs(DATA_DIR, exist_ok=True)
if os.path.exists(DB_PATH):
    with open(DB_PATH, 'r', encoding='utf-8') as f:
        db = json.load(f)
else:
    db = json.loads(json.dumps(EMPTY))
for key in EMPTY:
    if not isinstance(db.get(key), list):
        db[key] = []

# Signing secret persisted across restarts so sessions survive a reboot.
if os.path.exists(SECRET_PATH):
    with open(SECRET_PATH, 'r', encoding='utf-8') as f:
        SECRET = f.read().strip().encode()
else:
    SECRET = secrets.token_hex(32).encode()
    with open(SECRET_PATH, 'w', encoding='utf-8') as f:
        f.write(SECRET.decode())

# Optional settings (currently: Google sign-in). Set GOOGLE_CLIENT_ID as an
# environment variable, or put {"googleClientId": "..."} in data/config.json.
CONFIG_PATH = os.path.join(DATA_DIR, 'config.json')
_config = {}
if os.path.exists(CONFIG_PATH):
    try:
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            _config = json.load(f)
    except Exception:
        _config = {}
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID') or _config.get('googleClientId') or ''

# Email sending (verification links). Without SMTP settings the app runs in
# "dev mode": the verification link is shown in the UI instead of emailed.
SMTP_HOST = os.environ.get('SMTP_HOST') or _config.get('smtpHost') or ''
SMTP_PORT = int(os.environ.get('SMTP_PORT') or _config.get('smtpPort') or 587)
SMTP_USER = os.environ.get('SMTP_USER') or _config.get('smtpUser') or ''
SMTP_PASS = os.environ.get('SMTP_PASS') or _config.get('smtpPass') or ''
SMTP_FROM = os.environ.get('SMTP_FROM') or _config.get('smtpFrom') or SMTP_USER
BASE_URL = (os.environ.get('BASE_URL') or _config.get('baseUrl') or f'http://localhost:{PORT}').rstrip('/')
EMAIL_ENABLED = bool(SMTP_HOST and SMTP_FROM)

LOCK = threading.RLock()


def save():
    with LOCK:
        tmp = DB_PATH + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(db, f, indent=2)
        os.replace(tmp, DB_PATH)


def uid():
    return str(uuid.uuid4())


def now_iso():
    return datetime.now(timezone.utc).isoformat()


DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
TIME_RE = re.compile(r'^\d{2}:\d{2}$')
USERNAME_RE = re.compile(r'^[a-zA-Z0-9._-]{3,24}$')


# ---------------- auth helpers ----------------

def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)
    return salt.hex() + '$' + digest.hex()


def check_password(password, stored):
    try:
        salt_hex, digest_hex = stored.split('$')
        digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=16384, r=8, p=1)
        return hmac.compare_digest(digest.hex(), digest_hex)
    except Exception:
        return False


def issue_token(user):
    exp = int(time.time()) + 30 * 86400
    payload = f"{user['id']}.{exp}"
    sig = hmac.new(SECRET, payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def verify_token(token):
    try:
        user_id, exp, sig = token.rsplit('.', 2)
        payload = f"{user_id}.{exp}"
        expected = hmac.new(SECRET, payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        if int(exp) < time.time():
            return None
        return next((u for u in db['users'] if u['id'] == user_id), None)
    except Exception:
        return None


def public_user(u):
    return {'id': u['id'], 'username': u['username']}


# ---------------- routing ----------------

ROUTES = []


def route(method, pattern, needs_auth=True):
    rx = re.compile('^' + pattern + '$')

    def deco(fn):
        ROUTES.append((method, rx, fn, needs_auth))
        return fn
    return deco


def clean_str(value, limit):
    return str(value or '').strip()[:limit]


# ---------------- captcha ----------------
# Self-contained: the server draws a distorted-character SVG and remembers the
# answer for 10 minutes. Each captcha is single-use (consumed on any attempt).

CAPTCHA_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'  # no ambiguous 0/O/1/I
_captchas = {}  # id -> (text, expires_at)


def make_captcha_svg(text):
    rnd = random.Random()
    w, ht = 210, 70
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{ht}" viewBox="0 0 {w} {ht}">']
    for _ in range(4):
        parts.append(
            f'<path d="M{rnd.randint(0, w)} {rnd.randint(0, ht)} Q {rnd.randint(0, w)} {rnd.randint(0, ht)} '
            f'{rnd.randint(0, w)} {rnd.randint(0, ht)}" stroke="#8a91a5" stroke-width="1.5" fill="none" opacity="0.55"/>')
    glyphs = []
    x = 22
    for ch in text:
        rot = rnd.randint(-28, 28)
        y = rnd.randint(40, 54)
        size = rnd.randint(27, 36)
        glyphs.append(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="bold" '
                      f'font-family="Georgia, serif" fill="currentColor" transform="rotate({rot} {x} {y})">{ch}</text>')
        x += 34
    # Invisible decoy glyphs + shuffled markup order make naive DOM-scraping harder.
    for _ in range(4):
        glyphs.append(f'<text x="{rnd.randint(10, w - 20)}" y="{rnd.randint(35, 55)}" font-size="30" '
                      f'fill="currentColor" opacity="0">{rnd.choice(CAPTCHA_CHARS)}</text>')
    rnd.shuffle(glyphs)
    parts.extend(glyphs)
    for _ in range(30):
        parts.append(f'<circle cx="{rnd.randint(0, w)}" cy="{rnd.randint(0, ht)}" r="1" fill="#8a91a5" opacity="0.5"/>')
    parts.append('</svg>')
    return ''.join(parts)


@route('GET', '/api/captcha', needs_auth=False)
def get_captcha(user, body):
    with LOCK:
        now = time.time()
        for key in [k for k, v in _captchas.items() if v[1] < now]:
            _captchas.pop(key, None)
        if len(_captchas) > 5000:
            _captchas.clear()
        text = ''.join(secrets.choice(CAPTCHA_CHARS) for _ in range(5))
        cid = uid()
        _captchas[cid] = (text, now + 600)
    return 200, {'captchaId': cid, 'svg': make_captcha_svg(text)}


def check_captcha(body):
    cid = str(body.get('captchaId') or '')
    answer = str(body.get('captchaAnswer') or '').strip().upper()
    with LOCK:
        entry = _captchas.pop(cid, None)
    return bool(entry and entry[1] >= time.time() and answer and answer == entry[0])


# ---------------- email verification ----------------

EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


def send_verification_email(to_addr, token):
    link = f'{BASE_URL}/#/verify/{token}'
    msg = EmailMessage()
    msg['Subject'] = 'Verify your Momentum account'
    msg['From'] = SMTP_FROM
    msg['To'] = to_addr
    msg.set_content(
        'Welcome to Momentum!\n\n'
        f'Click this link to verify your account:\n{link}\n\n'
        "If you didn't sign up, you can ignore this email.")
    try:
        if SMTP_PORT == 465:
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=15) as s:
                if SMTP_USER:
                    s.login(SMTP_USER, SMTP_PASS)
                s.send_message(msg)
        else:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as s:
                s.starttls()
                if SMTP_USER:
                    s.login(SMTP_USER, SMTP_PASS)
                s.send_message(msg)
        return True
    except Exception:
        return False


# ---------------- auth ----------------

@route('POST', '/api/auth/register', needs_auth=False)
def register(user, body):
    if not check_captcha(body):
        return 400, {'error': 'Captcha was wrong or expired — try the new one', 'captchaFailed': True}
    username = clean_str(body.get('username'), 24)
    email = clean_str(body.get('email'), 120).lower()
    password = str(body.get('password') or '')
    if not USERNAME_RE.match(username):
        return 400, {'error': 'Username must be 3-24 characters (letters, numbers, . _ -)'}
    if not EMAIL_RE.match(email):
        return 400, {'error': 'Enter a valid email address'}
    if len(password) < 6:
        return 400, {'error': 'Password must be at least 6 characters'}
    with LOCK:
        if any(u['username'].lower() == username.lower() for u in db['users']):
            return 409, {'error': 'That username is taken'}
        if any((u.get('email') or '').lower() == email for u in db['users']):
            return 409, {'error': 'An account with that email already exists'}
        verify_token_val = uid()
        new_user = {'id': uid(), 'username': username, 'email': email, 'emailVerified': False,
                    'verifyToken': verify_token_val, 'passwordHash': hash_password(password), 'createdAt': now_iso()}
        db['users'].append(new_user)
        save()
    if EMAIL_ENABLED:
        if send_verification_email(email, verify_token_val):
            return 200, {'needsVerification': True, 'message': f'We sent a verification link to {email}. Click it to activate your account.'}
        return 200, {'needsVerification': True, 'message': 'Account created, but the verification email could not be sent right now. Use “Resend” in a minute.'}
    return 200, {'needsVerification': True,
                 'message': 'This server has no email sending configured, so verify with the button below instead:',
                 'devVerifyUrl': f'/#/verify/{verify_token_val}'}


@route('POST', '/api/auth/verify', needs_auth=False)
def verify_email(user, body):
    token_val = str(body.get('token') or '')
    with LOCK:
        found = next((u for u in db['users'] if token_val and u.get('verifyToken') == token_val), None)
        if not found:
            return 400, {'error': 'This verification link is invalid or was already used'}
        found['emailVerified'] = True
        found.pop('verifyToken', None)
        save()
    return 200, {'token': issue_token(found), 'user': public_user(found)}


@route('POST', '/api/auth/resend', needs_auth=False)
def resend_verification(user, body):
    if not check_captcha(body):
        return 400, {'error': 'Captcha was wrong or expired — try the new one', 'captchaFailed': True}
    ident = clean_str(body.get('identifier'), 120).lower()
    with LOCK:
        found = next((u for u in db['users']
                      if u['username'].lower() == ident or (u.get('email') or '').lower() == ident), None)
        if found and found.get('email') and not found.get('emailVerified'):
            if not found.get('verifyToken'):
                found['verifyToken'] = uid()
                save()
            token_val = found['verifyToken']
        else:
            found = None
    generic = {'message': 'If that account needs verification, a new link is on its way.'}
    if not found:
        return 200, generic
    if EMAIL_ENABLED:
        send_verification_email(found['email'], token_val)
        return 200, generic
    return 200, {'message': 'This server has no email sending configured — verify with the button below:',
                 'devVerifyUrl': f'/#/verify/{token_val}'}


@route('POST', '/api/auth/login', needs_auth=False)
def login(user, body):
    if not check_captcha(body):
        return 400, {'error': 'Captcha was wrong or expired — try the new one', 'captchaFailed': True}
    username = clean_str(body.get('username'), 24)
    password = str(body.get('password') or '')
    found = next((u for u in db['users'] if u['username'].lower() == username.lower()), None)
    if found and not found.get('passwordHash'):
        return 401, {'error': 'This account uses Google sign-in'}
    if not found or not check_password(password, found.get('passwordHash') or ''):
        return 401, {'error': 'Wrong username or password'}
    # Accounts created before email support have no email and stay usable.
    if found.get('email') and not found.get('emailVerified'):
        return 403, {'error': 'Please verify your email first — check your inbox.', 'unverified': True}
    return 200, {'token': issue_token(found), 'user': public_user(found)}


@route('GET', '/api/config', needs_auth=False)
def get_config(user, body):
    return 200, {'googleClientId': GOOGLE_CLIENT_ID}


@route('POST', '/api/auth/google', needs_auth=False)
def google_auth(user, body):
    if not GOOGLE_CLIENT_ID:
        return 400, {'error': 'Google sign-in is not configured on this server'}
    credential = str(body.get('credential') or '')
    if not credential:
        return 400, {'error': 'Missing Google credential'}
    # Verify the ID token with Google (aud must match our client id).
    try:
        url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + urllib.parse.quote(credential)
        with urllib.request.urlopen(url, timeout=10) as resp:
            info = json.load(resp)
    except Exception:
        return 401, {'error': 'Could not verify Google sign-in'}
    if info.get('aud') != GOOGLE_CLIENT_ID:
        return 401, {'error': 'Google sign-in was issued for a different app'}
    if str(info.get('email_verified')).lower() != 'true':
        return 401, {'error': 'Google account email is not verified'}
    sub = str(info.get('sub') or '')
    email = str(info.get('email') or '')
    if not sub:
        return 401, {'error': 'Could not verify Google sign-in'}
    with LOCK:
        found = next((u for u in db['users'] if u.get('googleSub') == sub), None)
        if not found:
            base = re.sub(r'[^a-zA-Z0-9._-]', '', email.split('@')[0])[:20] or 'user'
            username = base
            suffix = 1
            while any(u['username'].lower() == username.lower() for u in db['users']):
                suffix += 1
                username = f'{base}{suffix}'
            found = {'id': uid(), 'username': username, 'googleSub': sub, 'email': email,
                     'emailVerified': True, 'createdAt': now_iso()}
            db['users'].append(found)
            save()
    return 200, {'token': issue_token(found), 'user': public_user(found)}


@route('GET', '/api/me')
def me(user, body):
    return 200, {'user': public_user(user)}


# ---------------- days & tasks ----------------

def day_with_tasks(day):
    tasks = sorted((t for t in db['tasks'] if t['dayId'] == day['id']), key=lambda t: t['order'])
    return {
        'id': day['id'], 'date': day['date'], 'reflection': day['reflection'],
        'tasks': [{'id': t['id'], 'title': t['title'], 'minutes': t['minutes'], 'completed': t['completed']} for t in tasks]
    }


@route('GET', '/api/days')
def list_days(user, body):
    days = [day_with_tasks(d) for d in db['days'] if d['userId'] == user['id']]
    days.sort(key=lambda d: d['date'], reverse=True)
    return 200, {'days': days}


@route('GET', '/api/days/(\\d{4}-\\d{2}-\\d{2})')
def get_day(user, body, date):
    day = next((d for d in db['days'] if d['userId'] == user['id'] and d['date'] == date), None)
    if not day:
        return 404, {'error': 'No checklist for this day yet'}
    return 200, {'day': day_with_tasks(day)}


@route('POST', '/api/days')
def create_day(user, body):
    date = str(body.get('date') or '')
    if not DATE_RE.match(date):
        return 400, {'error': 'Invalid date'}
    with LOCK:
        if any(d['userId'] == user['id'] and d['date'] == date for d in db['days']):
            return 409, {'error': 'A checklist for this day already exists'}
        day = {'id': uid(), 'userId': user['id'], 'date': date, 'reflection': ''}
        db['days'].append(day)
        order = 0
        preset_ids = body.get('presetIds') if isinstance(body.get('presetIds'), list) else []
        for pid in preset_ids:
            preset = next((p for p in db['presets'] if p['id'] == pid and p['userId'] == user['id']), None)
            if not preset:
                continue
            for t in preset['tasks']:
                db['tasks'].append({'id': uid(), 'userId': user['id'], 'dayId': day['id'],
                                    'title': t['title'], 'minutes': 0, 'completed': False, 'order': order})
                order += 1
        save()
    return 200, {'day': day_with_tasks(day)}


@route('PATCH', '/api/days/([0-9a-f-]{36})')
def update_day(user, body, day_id):
    day = next((d for d in db['days'] if d['id'] == day_id and d['userId'] == user['id']), None)
    if not day:
        return 404, {'error': 'Day not found'}
    with LOCK:
        if isinstance(body.get('reflection'), str):
            day['reflection'] = body['reflection'][:5000]
        save()
    return 200, {'day': day_with_tasks(day)}


@route('POST', '/api/days/([0-9a-f-]{36})/tasks')
def add_task(user, body, day_id):
    day = next((d for d in db['days'] if d['id'] == day_id and d['userId'] == user['id']), None)
    if not day:
        return 404, {'error': 'Day not found'}
    title = clean_str(body.get('title'), 200)
    if not title:
        return 400, {'error': 'Task needs a title'}
    with LOCK:
        order = sum(1 for t in db['tasks'] if t['dayId'] == day['id'])
        task = {'id': uid(), 'userId': user['id'], 'dayId': day['id'],
                'title': title, 'minutes': 0, 'completed': False, 'order': order}
        db['tasks'].append(task)
        save()
    return 200, {'task': {'id': task['id'], 'title': title, 'minutes': 0, 'completed': False}}


@route('PATCH', '/api/tasks/([0-9a-f-]{36})')
def update_task(user, body, task_id):
    task = next((t for t in db['tasks'] if t['id'] == task_id and t['userId'] == user['id']), None)
    if not task:
        return 404, {'error': 'Task not found'}
    with LOCK:
        if isinstance(body.get('completed'), bool):
            task['completed'] = body['completed']
        if body.get('minutes') is not None:
            try:
                task['minutes'] = min(max(round(float(body['minutes'])), 0), 10000)
            except (TypeError, ValueError):
                pass
        if isinstance(body.get('title'), str) and body['title'].strip():
            task['title'] = body['title'].strip()[:200]
        save()
    return 200, {'task': {'id': task['id'], 'title': task['title'], 'minutes': task['minutes'], 'completed': task['completed']}}


@route('DELETE', '/api/tasks/([0-9a-f-]{36})')
def delete_task(user, body, task_id):
    with LOCK:
        before = len(db['tasks'])
        db['tasks'] = [t for t in db['tasks'] if not (t['id'] == task_id and t['userId'] == user['id'])]
        if len(db['tasks']) == before:
            return 404, {'error': 'Task not found'}
        save()
    return 200, {'ok': True}


# ---------------- presets ----------------

def normalize_tasks(raw):
    if not isinstance(raw, list):
        return []
    out = []
    for t in raw:
        title = t.get('title') if isinstance(t, dict) else t
        title = clean_str(title, 200)
        if title:
            out.append({'title': title})
    return out


def public_preset(p):
    return {'id': p['id'], 'name': p['name'], 'tasks': p['tasks']}


@route('GET', '/api/presets')
def list_presets(user, body):
    return 200, {'presets': [public_preset(p) for p in db['presets'] if p['userId'] == user['id']]}


@route('POST', '/api/presets')
def create_preset(user, body):
    name = clean_str(body.get('name'), 100)
    if not name:
        return 400, {'error': 'Preset needs a name'}
    with LOCK:
        preset = {'id': uid(), 'userId': user['id'], 'name': name, 'tasks': normalize_tasks(body.get('tasks'))}
        db['presets'].append(preset)
        save()
    return 200, {'preset': public_preset(preset)}


@route('PATCH', '/api/presets/([0-9a-f-]{36})')
def update_preset(user, body, preset_id):
    preset = next((p for p in db['presets'] if p['id'] == preset_id and p['userId'] == user['id']), None)
    if not preset:
        return 404, {'error': 'Preset not found'}
    with LOCK:
        if isinstance(body.get('name'), str) and body['name'].strip():
            preset['name'] = body['name'].strip()[:100]
        if body.get('tasks') is not None:
            preset['tasks'] = normalize_tasks(body['tasks'])
        save()
    return 200, {'preset': public_preset(preset)}


@route('DELETE', '/api/presets/([0-9a-f-]{36})')
def delete_preset(user, body, preset_id):
    with LOCK:
        before = len(db['presets'])
        db['presets'] = [p for p in db['presets'] if not (p['id'] == preset_id and p['userId'] == user['id'])]
        if len(db['presets']) == before:
            return 404, {'error': 'Preset not found'}
        save()
    return 200, {'ok': True}


# ---------------- bulletin notes ----------------

def public_note(n):
    return {'id': n['id'], 'content': n['content'], 'color': n['color'], 'createdAt': n['createdAt']}


@route('GET', '/api/notes')
def list_notes(user, body):
    return 200, {'notes': [public_note(n) for n in db['notes'] if n['userId'] == user['id']]}


@route('POST', '/api/notes')
def create_note(user, body):
    content = clean_str(body.get('content'), 2000)
    if not content:
        return 400, {'error': 'Note is empty'}
    with LOCK:
        note = {'id': uid(), 'userId': user['id'], 'content': content,
                'color': str(body.get('color') or ''), 'createdAt': now_iso()}
        db['notes'].append(note)
        save()
    return 200, {'note': public_note(note)}


@route('PATCH', '/api/notes/([0-9a-f-]{36})')
def update_note(user, body, note_id):
    note = next((n for n in db['notes'] if n['id'] == note_id and n['userId'] == user['id']), None)
    if not note:
        return 404, {'error': 'Note not found'}
    with LOCK:
        if isinstance(body.get('content'), str) and body['content'].strip():
            note['content'] = body['content'].strip()[:2000]
        if isinstance(body.get('color'), str):
            note['color'] = body['color']
        save()
    return 200, {'note': public_note(note)}


@route('DELETE', '/api/notes/([0-9a-f-]{36})')
def delete_note(user, body, note_id):
    with LOCK:
        before = len(db['notes'])
        db['notes'] = [n for n in db['notes'] if not (n['id'] == note_id and n['userId'] == user['id'])]
        if len(db['notes']) == before:
            return 404, {'error': 'Note not found'}
        save()
    return 200, {'ok': True}


# ---------------- goals ----------------

def public_goal(g):
    return {'id': g['id'], 'title': g['title'], 'description': g['description'],
            'targetDate': g['targetDate'], 'completed': g['completed'], 'createdAt': g['createdAt']}


@route('GET', '/api/goals')
def list_goals(user, body):
    return 200, {'goals': [public_goal(g) for g in db['goals'] if g['userId'] == user['id']]}


@route('POST', '/api/goals')
def create_goal(user, body):
    title = clean_str(body.get('title'), 200)
    if not title:
        return 400, {'error': 'Goal needs a title'}
    target = body.get('targetDate') or ''
    with LOCK:
        goal = {'id': uid(), 'userId': user['id'], 'title': title,
                'description': clean_str(body.get('description'), 2000),
                'targetDate': target if DATE_RE.match(str(target)) else '',
                'completed': False, 'createdAt': now_iso()}
        db['goals'].append(goal)
        save()
    return 200, {'goal': public_goal(goal)}


@route('PATCH', '/api/goals/([0-9a-f-]{36})')
def update_goal(user, body, goal_id):
    goal = next((g for g in db['goals'] if g['id'] == goal_id and g['userId'] == user['id']), None)
    if not goal:
        return 404, {'error': 'Goal not found'}
    with LOCK:
        if isinstance(body.get('title'), str) and body['title'].strip():
            goal['title'] = body['title'].strip()[:200]
        if isinstance(body.get('description'), str):
            goal['description'] = body['description'].strip()[:2000]
        if body.get('targetDate') is not None:
            goal['targetDate'] = body['targetDate'] if DATE_RE.match(str(body['targetDate'])) else ''
        if isinstance(body.get('completed'), bool):
            goal['completed'] = body['completed']
        save()
    return 200, {'goal': public_goal(goal)}


@route('DELETE', '/api/goals/([0-9a-f-]{36})')
def delete_goal(user, body, goal_id):
    with LOCK:
        before = len(db['goals'])
        db['goals'] = [g for g in db['goals'] if not (g['id'] == goal_id and g['userId'] == user['id'])]
        if len(db['goals']) == before:
            return 404, {'error': 'Goal not found'}
        save()
    return 200, {'ok': True}


# ---------------- calendar events ----------------

def normalize_reminders(raw):
    if not isinstance(raw, list):
        return []
    mins = set()
    for m in raw:
        try:
            v = round(float(m))
        except (TypeError, ValueError):
            continue
        if 0 <= v <= 20160:  # up to 2 weeks before
            mins.add(v)
    return sorted(mins)


def public_event(e):
    return {'id': e['id'], 'title': e['title'], 'description': e['description'],
            'date': e['date'], 'time': e['time'], 'reminders': e['reminders']}


@route('GET', '/api/events')
def list_events(user, body):
    return 200, {'events': [public_event(e) for e in db['events'] if e['userId'] == user['id']]}


@route('POST', '/api/events')
def create_event(user, body):
    title = clean_str(body.get('title'), 200)
    if not title:
        return 400, {'error': 'Event needs a title'}
    if not DATE_RE.match(str(body.get('date') or '')):
        return 400, {'error': 'Invalid date'}
    if not TIME_RE.match(str(body.get('time') or '')):
        return 400, {'error': 'Invalid time'}
    with LOCK:
        event = {'id': uid(), 'userId': user['id'], 'title': title,
                 'description': clean_str(body.get('description'), 2000),
                 'date': body['date'], 'time': body['time'],
                 'reminders': normalize_reminders(body.get('reminders'))}
        db['events'].append(event)
        save()
    return 200, {'event': public_event(event)}


@route('PATCH', '/api/events/([0-9a-f-]{36})')
def update_event(user, body, event_id):
    event = next((e for e in db['events'] if e['id'] == event_id and e['userId'] == user['id']), None)
    if not event:
        return 404, {'error': 'Event not found'}
    with LOCK:
        if isinstance(body.get('title'), str) and body['title'].strip():
            event['title'] = body['title'].strip()[:200]
        if isinstance(body.get('description'), str):
            event['description'] = body['description'].strip()[:2000]
        if body.get('date') is not None and DATE_RE.match(str(body['date'])):
            event['date'] = body['date']
        if body.get('time') is not None and TIME_RE.match(str(body['time'])):
            event['time'] = body['time']
        if body.get('reminders') is not None:
            event['reminders'] = normalize_reminders(body['reminders'])
        save()
    return 200, {'event': public_event(event)}


@route('DELETE', '/api/events/([0-9a-f-]{36})')
def delete_event(user, body, event_id):
    with LOCK:
        before = len(db['events'])
        db['events'] = [e for e in db['events'] if not (e['id'] == event_id and e['userId'] == user['id'])]
        if len(db['events']) == before:
            return 404, {'error': 'Event not found'}
        save()
    return 200, {'ok': True}


# ---------------- HTTP handler ----------------

class Handler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC, **kwargs)

    def handle_api(self, method):
        path = urlparse(self.path).path
        if not path.startswith('/api/'):
            return False
        for m, rx, fn, needs_auth in ROUTES:
            if m != method:
                continue
            match = rx.match(path)
            if not match:
                continue
            user = None
            if needs_auth:
                authz = self.headers.get('Authorization', '')
                token = authz[7:] if authz.startswith('Bearer ') else ''
                user = verify_token(token)
                if not user:
                    self.send_json(401, {'error': 'Not signed in'})
                    return True
            body = {}
            length = int(self.headers.get('Content-Length') or 0)
            if length:
                try:
                    body = json.loads(self.rfile.read(length))
                except Exception:
                    body = {}
            if not isinstance(body, dict):
                body = {}
            try:
                status, obj = fn(user, body, *match.groups())
            except Exception:
                status, obj = 500, {'error': 'Server error'}
            self.send_json(status, obj)
            return True
        self.send_json(404, {'error': 'Not found'})
        return True

    def send_json(self, status, obj):
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.handle_api('GET'):
            return
        # SPA fallback: extensionless paths serve the app shell.
        path = urlparse(self.path).path
        if path != '/' and '.' not in os.path.basename(path):
            self.path = '/index.html'
        super().do_GET()

    def do_POST(self):
        if not self.handle_api('POST'):
            self.send_json(404, {'error': 'Not found'})

    def do_PATCH(self):
        if not self.handle_api('PATCH'):
            self.send_json(404, {'error': 'Not found'})

    def do_DELETE(self):
        if not self.handle_api('DELETE'):
            self.send_json(404, {'error': 'Not found'})

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    server = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    print(f'Momentum running at http://localhost:{PORT}')
    server.serve_forever()
