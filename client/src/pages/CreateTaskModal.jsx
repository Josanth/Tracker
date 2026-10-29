import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { notifyChange } from '../sync.js';
import { Alert, Field, Modal, PRIORITIES, todayISO } from '../components.jsx';

const draftKey = (projectId) => `tracker.taskDraft.${projectId}`;
const newDraft = (defaults = {}) => ({
  title: '',
  description: '',
  priority: 'Medium',
  assigneeId: '',
  dueDate: '',
  ...defaults,
  clientRequestId: crypto.randomUUID(),
});

function loadDraft(projectId) {
  try {
    return JSON.parse(sessionStorage.getItem(draftKey(projectId)));
  } catch {
    return null;
  }
}
function saveDraft(projectId, draft) {
  try {
    sessionStorage.setItem(draftKey(projectId), JSON.stringify(draft));
  } catch {
    /* storage unavailable: the in-memory form still works */
  }
}
export function hasTaskDraft(projectId) {
  const d = loadDraft(projectId);
  return !!(d && (d.title || d.description));
}

/**
 * Duplicate-safe task creation: every draft carries a clientRequestId (persisted in sessionStorage
 * together with the form), so a refresh, double-click or retry re-sends the same id and the server
 * returns the already-created task instead of making a second one.
 */
export default function CreateTaskModal({ project, onClose, onCreated }) {
  const [form, setForm] = useState(() => loadDraft(project.id) || newDraft());
  const [restored] = useState(() => hasTaskDraft(project.id));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  useEffect(() => saveDraft(project.id, form), [project.id, form]);

  function discard() {
    sessionStorage.removeItem(draftKey(project.id));
    onClose();
  }

  async function submit(e) {
    e.preventDefault();
    const v = {};
    if (!form.title.trim()) v.title = 'Task title is required';
    if (form.dueDate && form.dueDate < todayISO()) v.dueDate = 'Due date cannot be in the past';
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      const d = await api(`/projects/${project.id}/tasks`, {
        method: 'POST',
        body: { ...form, assigneeId: form.assigneeId || null },
      });
      sessionStorage.removeItem(draftKey(project.id));
      notifyChange(`project:${project.id}`);
      onCreated(d.task);
    } catch (err) {
      setErrors({ ...err.fields, form: err.message });
      setBusy(false);
    }
  }

  return (
    <Modal title={`New task in ${project.key}`} onClose={onClose} wide>
      <form onSubmit={submit} noValidate>
        {restored && (
          <Alert kind="info">
            Restored your unsaved draft. If it was already submitted, saving again will not create a duplicate.
          </Alert>
        )}
        <Alert>{errors.form}</Alert>
        <Field label="Title" error={errors.title}>
          <input value={form.title} onChange={set('title')} autoFocus maxLength={200} />
        </Field>
        <Field label="Description">
          <textarea rows={4} value={form.description} onChange={set('description')} />
        </Field>
        <div className="form-grid form-grid-3">
          <Field label="Priority" error={errors.priority}>
            <select value={form.priority} onChange={set('priority')}>
              {PRIORITIES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Field label="Assignee" error={errors.assigneeId} hint="Only project members can be assigned">
            <select value={form.assigneeId} onChange={set('assigneeId')}>
              <option value="">Unassigned</option>
              {project.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Due date" error={errors.dueDate}>
            <input type="date" value={form.dueDate} min={todayISO()} onChange={set('dueDate')} />
          </Field>
        </div>
        <p className="muted small">New tasks start in To Do. Reporter: you.</p>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={discard}>
            Discard
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create task'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
