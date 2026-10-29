import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, Avatar, Field } from '../components.jsx';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function ProfilePage() {
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({ name: user.name, email: user.email, currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setSaved(false);
    const v = {};
    if (!form.name.trim()) v.name = 'Name is required';
    if (!form.email.trim()) v.email = 'Email is required';
    else if (!EMAIL_RE.test(form.email.trim())) v.email = 'Email format is invalid';
    if (form.newPassword) {
      if (form.newPassword.length < 8) v.newPassword = 'Password must be at least 8 characters';
      if (!form.currentPassword) v.currentPassword = 'Enter your current password to change it';
      if (form.confirm !== form.newPassword) v.confirm = 'Passwords do not match';
    }
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      const d = await api('/me', {
        method: 'PUT',
        body: { name: form.name, email: form.email, currentPassword: form.currentPassword || undefined, newPassword: form.newPassword || undefined },
      });
      setUser(d.user);
      setForm({ ...form, name: d.user.name, email: d.user.email, currentPassword: '', newPassword: '', confirm: '' });
      setSaved(true);
    } catch (err) {
      setErrors({ ...err.fields, form: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page narrow">
      <div className="page-header">
        <div className="inline-user">
          <Avatar user={user} size={48} />
          <div>
            <h1>{user.name}</h1>
            <p className="muted">
              {user.email} · {user.role === 'admin' ? 'Administrator' : 'Member'}
            </p>
          </div>
        </div>
      </div>
      <form className="panel" onSubmit={submit} noValidate>
        {saved && <Alert kind="success">Profile updated.</Alert>}
        <Alert>{errors.form}</Alert>
        <h2>Profile</h2>
        <Field label="Full name" error={errors.name}>
          <input value={form.name} onChange={set('name')} />
        </Field>
        <Field label="Email" error={errors.email}>
          <input type="email" value={form.email} onChange={set('email')} />
        </Field>
        <h2>Change password</h2>
        <p className="muted small">Leave blank to keep your current password.</p>
        <Field label="Current password" error={errors.currentPassword}>
          <input type="password" autoComplete="current-password" value={form.currentPassword} onChange={set('currentPassword')} />
        </Field>
        <div className="form-grid">
          <Field label="New password" error={errors.newPassword} hint="At least 8 characters">
            <input type="password" autoComplete="new-password" value={form.newPassword} onChange={set('newPassword')} />
          </Field>
          <Field label="Confirm new password" error={errors.confirm}>
            <input type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />
          </Field>
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </form>
    </div>
  );
}
