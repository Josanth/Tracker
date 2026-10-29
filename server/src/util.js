export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const badRequest = (message, fields) =>
  new HttpError(400, 'VALIDATION_ERROR', message, fields ? { fields } : {});
export const unauthorized = (message = 'Authentication required') =>
  new HttpError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have access to this resource') =>
  new HttpError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (code, message, extra) => new HttpError(409, code, message, extra);

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;

export const PRIORITIES = ['Low', 'Medium', 'High'];
export const STATUSES = ['To Do', 'In Progress', 'In Review', 'Done'];

// Collects field errors and throws a single 400 listing all of them.
export class Validator {
  constructor() {
    this.fields = {};
  }
  error(field, message) {
    if (!this.fields[field]) this.fields[field] = message;
    return this;
  }
  required(field, value, label = field) {
    if (value === undefined || value === null || String(value).trim() === '') {
      this.error(field, `${label} is required`);
      return false;
    }
    return true;
  }
  date(field, value, label = field) {
    if (value === undefined || value === null || value === '') return true;
    if (!isValidDate(value)) {
      this.error(field, `${label} must be a valid date (YYYY-MM-DD)`);
      return false;
    }
    return true;
  }
  throwIfAny() {
    const keys = Object.keys(this.fields);
    if (keys.length) throw badRequest(this.fields[keys[0]], this.fields);
  }
}

export function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// "Today" is the server's local calendar date; all due dates are date-only strings.
export function today(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// End of the current Monday–Sunday week.
export function endOfWeek(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysToSunday = (7 - d.getDay()) % 7;
  d.setDate(d.getDate() + daysToSunday);
  return today(d);
}

export const trimOrEmpty = (v) => (typeof v === 'string' ? v.trim() : '');
export const emptyToNull = (v) => (v === undefined || v === null || v === '' ? null : v);
