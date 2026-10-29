import { useState } from 'react';
import { Link, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Field, Alert } from '../components.jsx';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="brand brand-lg">
          <span className="brand-mark">◆</span> Tracker
        </div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
        {footer && <div className="auth-footer">{footer}</div>}
      </div>
    </div>
  );
}

// Client-side checks mirror the server so users get instant feedback; the server remains authoritative.
function validate({ name, email, password, confirm }, mode) {
  const e = {};
  if (mode === 'register' && !name?.trim()) e.name = 'Name is required';
  if (mode !== 'reset') {
    if (!email?.trim()) e.email = 'Email is required';
    else if (!EMAIL_RE.test(email.trim())) e.email = 'Email format is invalid';
  }
  if (mode !== 'forgot') {
    if (!password) e.password = 'Password is required';
    else if (mode !== 'login' && password.length < 8) e.password = 'Password must be at least 8 characters';
  }
  if ((mode === 'register' || mode === 'reset') && password && confirm !== password) e.confirm = 'Passwords do not match';
  return e;
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(location.state?.message || '');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const v = validate(form, 'login');
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    setMessage('');
    try {
      const d = await api('/auth/login', { method: 'POST', body: form });
      login(d.token, d.user);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setErrors({ ...err.fields, form: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Log in"
      subtitle="Track projects and tasks with your team."
      footer={
        <>
          No account? <Link to="/register">Create one</Link>
        </>
      }
    >
      {message && <Alert kind="success">{message}</Alert>}
      <Alert>{errors.form}</Alert>
      <form onSubmit={submit} noValidate>
        <Field label="Email" error={errors.email}>
          <input type="email" autoComplete="email" autoFocus value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Password" error={errors.password}>
          <input type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <div className="form-row-end">
          <Link to="/forgot-password" className="small">
            Forgot password?
          </Link>
        </div>
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    const v = validate(form, 'register');
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      const d = await api('/auth/register', { method: 'POST', body: { name: form.name, email: form.email, password: form.password } });
      login(d.token, d.user);
      navigate('/', { replace: true });
    } catch (err) {
      setErrors({ ...err.fields, form: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      footer={
        <>
          Already registered? <Link to="/login">Log in</Link>
        </>
      }
    >
      <Alert>{errors.form}</Alert>
      <form onSubmit={submit} noValidate>
        <Field label="Full name" error={errors.name}>
          <input autoComplete="name" autoFocus value={form.name} onChange={set('name')} />
        </Field>
        <Field label="Email" error={errors.email}>
          <input type="email" autoComplete="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Password" error={errors.password} hint="At least 8 characters">
          <input type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />
        </Field>
        <Field label="Confirm password" error={errors.confirm}>
          <input type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const v = validate({ email }, 'forgot');
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      setResult(await api('/auth/forgot-password', { method: 'POST', body: { email } }));
    } catch (err) {
      setErrors({ ...err.fields, form: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your account email and we'll send you a reset link."
      footer={<Link to="/login">Back to log in</Link>}
    >
      <Alert>{errors.form}</Alert>
      {result ? (
        <>
          <Alert kind="success">{result.message}</Alert>
          {result.devResetToken && (
            <div className="dev-note">
              <strong>Development mode:</strong> no email server is configured, so here is the link that would have been emailed:
              <Link to={`/reset-password?token=${encodeURIComponent(result.devResetToken)}`}>Open reset link</Link>
            </div>
          )}
        </>
      ) : (
        <form onSubmit={submit} noValidate>
          <Field label="Email" error={errors.email}>
            <input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const v = validate(form, 'reset');
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      const d = await api('/auth/reset-password', { method: 'POST', body: { token, password: form.password } });
      navigate('/login', { replace: true, state: { message: d.message } });
    } catch (err) {
      setErrors({ ...err.fields, form: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Choose a new password" footer={<Link to="/login">Back to log in</Link>}>
      {!token && <Alert>This reset link is missing its token. Request a new one.</Alert>}
      <Alert>{errors.form}</Alert>
      <form onSubmit={submit} noValidate>
        <Field label="New password" error={errors.password} hint="At least 8 characters">
          <input type="password" autoComplete="new-password" autoFocus value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <Field label="Confirm new password" error={errors.confirm}>
          <input type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy || !token}>
          {busy ? 'Saving…' : 'Update password'}
        </button>
      </form>
    </AuthShell>
  );
}
