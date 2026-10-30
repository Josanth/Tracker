import { Router } from 'express';
import {
  hashPassword,
  verifyPassword,
  createSession,
  publicUser,
  authenticate,
  sha256,
  randomToken,
} from '../auth.js';
import { Validator, EMAIL_RE, HttpError, badRequest, conflict, trimOrEmpty } from '../util.js';

const RESET_MINUTES = 30;

function validatePassword(v, field, password) {
  if (v.required(field, password, 'Password') && String(password).length < 8) {
    v.error(field, 'Password must be at least 8 characters');
  }
}

function validateEmail(v, email) {
  if (v.required('email', email, 'Email') && !EMAIL_RE.test(email)) {
    v.error('email', 'Email format is invalid');
  }
}

const emailTaken = () =>
  conflict('EMAIL_TAKEN', 'An account with this email already exists', {
    fields: { email: 'An account with this email already exists' },
  });

export default function authRoutes(db, { exposeResetToken }) {
  const r = Router();
  const auth = authenticate(db);

  r.post('/auth/register', async (req, res) => {
    const name = trimOrEmpty(req.body.name);
    const email = trimOrEmpty(req.body.email).toLowerCase();
    const { password } = req.body;
    const v = new Validator();
    v.required('name', name, 'Name');
    validateEmail(v, email);
    validatePassword(v, 'password', password);
    v.throwIfAny();

    const passwordHash = hashPassword(password);
    const user = await db.tx(async (t) => {
      if (await t.get('SELECT 1 FROM users WHERE email = ?', email)) throw emailTaken();
      // Bootstrap: the very first account in an empty system becomes the administrator.
      const isFirst = (await t.get('SELECT COUNT(*) AS n FROM users')).n === 0;
      const info = await t.run(
        'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
        name,
        email,
        passwordHash,
        isFirst ? 'admin' : 'user'
      );
      return t.get('SELECT * FROM users WHERE id = ?', info.lastInsertRowid);
    });
    res.status(201).json({ token: await createSession(db, user.id), user: publicUser(user) });
  });

  r.post('/auth/login', async (req, res) => {
    const email = trimOrEmpty(req.body.email).toLowerCase();
    const { password } = req.body;
    const v = new Validator();
    v.required('email', email, 'Email');
    v.required('password', password, 'Password');
    v.throwIfAny();
    const user = await db.get('SELECT * FROM users WHERE email = ?', email);
    // Same message for unknown email and wrong password so accounts can't be enumerated.
    if (!user || !verifyPassword(String(password), user.password_hash)) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }
    res.json({ token: await createSession(db, user.id), user: publicUser(user) });
  });

  r.post('/auth/logout', auth, async (req, res) => {
    await db.run('DELETE FROM sessions WHERE token_hash = ?', req.tokenHash);
    res.status(204).end();
  });

  r.post('/auth/forgot-password', async (req, res) => {
    const email = trimOrEmpty(req.body.email).toLowerCase();
    const v = new Validator();
    validateEmail(v, email);
    v.throwIfAny();
    const user = await db.get('SELECT * FROM users WHERE email = ?', email);
    const body = { message: 'If an account exists for that email, a reset link has been sent.' };
    if (user) {
      const token = randomToken();
      const expires = new Date(Date.now() + RESET_MINUTES * 60_000).toISOString();
      await db.run('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), user.id, expires);
      // No mail server: the link is logged, and returned to the client in dev mode only.
      console.log(`[password reset] ${email}: /reset-password?token=${token}`);
      if (exposeResetToken) body.devResetToken = token;
    }
    res.json(body);
  });

  r.post('/auth/reset-password', async (req, res) => {
    const { token, password } = req.body;
    const v = new Validator();
    v.required('token', token, 'Reset token');
    validatePassword(v, 'password', password);
    v.throwIfAny();
    const passwordHash = hashPassword(password);
    await db.tx(async (t) => {
      const row = await t.get(
        'SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?',
        sha256(String(token)),
        new Date().toISOString()
      );
      if (!row) throw badRequest('Reset link is invalid or has expired', { token: 'Invalid or expired' });
      await t.run('UPDATE users SET password_hash = ? WHERE id = ?', passwordHash, row.user_id);
      await t.run("UPDATE password_resets SET used_at = datetime('now') WHERE token_hash = ?", row.token_hash);
      // Log out everywhere after a reset.
      await t.run('DELETE FROM sessions WHERE user_id = ?', row.user_id);
    });
    res.json({ message: 'Password updated. Please log in.' });
  });

  r.get('/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

  r.put('/me', auth, async (req, res) => {
    const name = trimOrEmpty(req.body.name);
    const email = trimOrEmpty(req.body.email).toLowerCase();
    const { currentPassword, newPassword } = req.body;
    const v = new Validator();
    v.required('name', name, 'Name');
    validateEmail(v, email);
    if (newPassword) {
      validatePassword(v, 'newPassword', newPassword);
      if (!currentPassword || !verifyPassword(String(currentPassword), req.user.password_hash)) {
        v.error('currentPassword', 'Current password is incorrect');
      }
    }
    v.throwIfAny();
    const newHash = newPassword ? hashPassword(newPassword) : null;
    const user = await db.tx(async (t) => {
      if (await t.get('SELECT id FROM users WHERE email = ? AND id <> ?', email, req.user.id)) throw emailTaken();
      await t.run('UPDATE users SET name = ?, email = ? WHERE id = ?', name, email, req.user.id);
      if (newHash) await t.run('UPDATE users SET password_hash = ? WHERE id = ?', newHash, req.user.id);
      return t.get('SELECT * FROM users WHERE id = ?', req.user.id);
    });
    res.json({ user: publicUser(user) });
  });

  // Directory lookup used when adding project members.
  r.get('/users', auth, async (req, res) => {
    const q = `%${trimOrEmpty(req.query.q)}%`;
    const users = await db.all('SELECT * FROM users WHERE name LIKE ? OR email LIKE ? ORDER BY name LIMIT 20', q, q);
    res.json({ users: users.map(publicUser) });
  });

  return r;
}
