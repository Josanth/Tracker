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
import { tx } from '../db.js';

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

export default function authRoutes(db, { exposeResetToken }) {
  const r = Router();
  const auth = authenticate(db);

  r.post('/auth/register', (req, res) => {
    const name = trimOrEmpty(req.body.name);
    const email = trimOrEmpty(req.body.email).toLowerCase();
    const { password } = req.body;
    const v = new Validator();
    v.required('name', name, 'Name');
    validateEmail(v, email);
    validatePassword(v, 'password', password);
    v.throwIfAny();

    const user = tx(db, () => {
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
        throw conflict('EMAIL_TAKEN', 'An account with this email already exists', {
          fields: { email: 'An account with this email already exists' },
        });
      }
      // Bootstrap: the very first account in an empty system becomes the administrator.
      const isFirst = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
      const info = db
        .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
        .run(name, email, hashPassword(password), isFirst ? 'admin' : 'user');
      return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    });
    res.status(201).json({ token: createSession(db, user.id), user: publicUser(user) });
  });

  r.post('/auth/login', (req, res) => {
    const email = trimOrEmpty(req.body.email).toLowerCase();
    const { password } = req.body;
    const v = new Validator();
    v.required('email', email, 'Email');
    v.required('password', password, 'Password');
    v.throwIfAny();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    // Same message for unknown email and wrong password so accounts can't be enumerated.
    if (!user || !verifyPassword(String(password), user.password_hash)) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }
    res.json({ token: createSession(db, user.id), user: publicUser(user) });
  });

  r.post('/auth/logout', auth, (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.tokenHash);
    res.status(204).end();
  });

  r.post('/auth/forgot-password', (req, res) => {
    const email = trimOrEmpty(req.body.email).toLowerCase();
    const v = new Validator();
    validateEmail(v, email);
    v.throwIfAny();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const body = { message: 'If an account exists for that email, a reset link has been sent.' };
    if (user) {
      const token = randomToken();
      const expires = new Date(Date.now() + RESET_MINUTES * 60_000).toISOString();
      db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
        sha256(token),
        user.id,
        expires
      );
      // No mail server: the link is logged, and returned to the client in dev mode only.
      console.log(`[password reset] ${email}: /reset-password?token=${token}`);
      if (exposeResetToken) body.devResetToken = token;
    }
    res.json(body);
  });

  r.post('/auth/reset-password', (req, res) => {
    const { token, password } = req.body;
    const v = new Validator();
    v.required('token', token, 'Reset token');
    validatePassword(v, 'password', password);
    v.throwIfAny();
    tx(db, () => {
      const row = db
        .prepare('SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?')
        .get(sha256(String(token)), new Date().toISOString());
      if (!row) throw badRequest('Reset link is invalid or has expired', { token: 'Invalid or expired' });
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), row.user_id);
      db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE token_hash = ?").run(row.token_hash);
      // Log out everywhere after a reset.
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
    });
    res.json({ message: 'Password updated. Please log in.' });
  });

  r.get('/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

  r.put('/me', auth, (req, res) => {
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
    const user = tx(db, () => {
      const clash = db.prepare('SELECT id FROM users WHERE email = ? AND id <> ?').get(email, req.user.id);
      if (clash) {
        throw conflict('EMAIL_TAKEN', 'An account with this email already exists', {
          fields: { email: 'An account with this email already exists' },
        });
      }
      db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').run(name, email, req.user.id);
      if (newPassword) {
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
      }
      return db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    });
    res.json({ user: publicUser(user) });
  });

  // Directory lookup used when adding project members.
  r.get('/users', auth, (req, res) => {
    const q = `%${trimOrEmpty(req.query.q)}%`;
    const users = db
      .prepare('SELECT * FROM users WHERE name LIKE ? OR email LIKE ? ORDER BY name LIMIT 20')
      .all(q, q);
    res.json({ users: users.map(publicUser) });
  });

  return r;
}
