import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { notifyChange, useLiveReload } from '../sync.js';
import { Alert, Field, Modal, Spinner, formatDate } from '../components.jsx';

const KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;

export function validateProject(f, creating) {
  const e = {};
  if (!f.name.trim()) e.name = 'Project name is required';
  if (creating) {
    if (!f.key.trim()) e.key = 'Project key is required';
    else if (!KEY_RE.test(f.key.trim().toUpperCase())) e.key = '2–10 letters/digits, starting with a letter';
  }
  if (f.startDate && f.endDate && f.endDate < f.startDate) e.endDate = 'End date cannot be earlier than the start date';
  return e;
}

export function ProjectFields({ form, setForm, errors, creating }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <>
      <div className="form-grid">
        <Field label="Project name" error={errors.name}>
          <input value={form.name} onChange={set('name')} autoFocus={creating} maxLength={100} />
        </Field>
        <Field
          label="Project key"
          error={errors.key}
          hint={creating ? 'Short code used in task IDs, e.g. LIB → LIB-1' : 'The key cannot be changed after creation'}
        >
          <input
            value={form.key}
            onChange={(e) => setForm({ ...form, key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
            disabled={!creating}
            maxLength={10}
            className="mono"
          />
        </Field>
      </div>
      <Field label="Description" error={errors.description}>
        <textarea rows={3} value={form.description} onChange={set('description')} />
      </Field>
      <div className="form-grid">
        <Field label="Start date" error={errors.startDate}>
          <input type="date" value={form.startDate} onChange={set('startDate')} />
        </Field>
        <Field label="End date" error={errors.endDate}>
          <input type="date" value={form.endDate} min={form.startDate || undefined} onChange={set('endDate')} />
        </Field>
      </div>
    </>
  );
}

function NewProjectModal({ onClose }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', key: '', description: '', startDate: '', endDate: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const v = validateProject(form, true);
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      const d = await api('/projects', { method: 'POST', body: form });
      notifyChange('projects');
      navigate(`/projects/${d.project.id}/board`);
    } catch (err) {
      setErrors({ ...err.fields, form: err.message });
      setBusy(false);
    }
  }

  return (
    <Modal title="New project" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Alert>{errors.form}</Alert>
        <ProjectFields form={form} setForm={setForm} errors={errors} creating />
        <p className="muted small">You will be the project owner and its first member.</p>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api('/projects')
      .then((d) => setProjects(d.projects))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  useLiveReload(load);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Projects</h1>
          <p className="muted">Projects you are a member of.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          + New project
        </button>
      </div>
      <Alert>{error}</Alert>
      {!projects ? (
        <Spinner />
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <h2>No projects yet</h2>
          <p className="muted">Create a project, or ask a project owner to add you as a member.</p>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            Create your first project
          </button>
        </div>
      ) : (
        <div className="project-grid">
          {projects.map((p) => {
            const pct = p.taskTotal ? Math.round((p.taskDone / p.taskTotal) * 100) : 0;
            return (
              <Link key={p.id} to={`/projects/${p.id}/board`} className="project-card">
                <div className="project-card-top">
                  <span className="project-key">{p.key}</span>
                  <span className="muted small">{p.memberCount} member{p.memberCount === 1 ? '' : 's'}</span>
                </div>
                <h3>{p.name}</h3>
                <p className="muted clamp-2">{p.description || 'No description'}</p>
                <div className="progress" aria-label={`${pct}% done`}>
                  <div className="progress-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="project-card-foot small muted">
                  <span>
                    {p.taskDone}/{p.taskTotal} done
                  </span>
                  <span>Owner: {p.owner.name}</span>
                </div>
                {(p.startDate || p.endDate) && (
                  <div className="small muted">
                    {formatDate(p.startDate)} → {formatDate(p.endDate)}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
      {creating && <NewProjectModal onClose={() => setCreating(false)} />}
    </div>
  );
}
