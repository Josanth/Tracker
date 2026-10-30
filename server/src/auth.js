import crypto from 'node:crypto';
import { unauthorized, forbidden } from './util.js';

const SESSION_DAYS = 7;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('base64url');

export async function createSession(db, userId) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), userId, expires);
  return token;
}

export const publicUser = (u) => u && { id: u.id, name: u.name, email: u.email, role: u.role };

export function authenticate(db) {
  return async (req, _res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return next(unauthorized());
    const row = await db.get(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
      sha256(token),
      new Date().toISOString()
    );
    if (!row) return next(unauthorized('Session expired, please log in again'));
    req.user = row;
    req.tokenHash = sha256(token);
    next();
  };
}

export function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') return next(forbidden('Administrator access required'));
  next();
}
