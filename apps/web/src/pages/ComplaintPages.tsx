import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { complaintSchema, PRIORITIES, REPORTER_ROLES, STATUSES } from '@fixmycampus/shared';
import type {
  Catalog,
  Complaint,
  ComplaintAction,
  ComplaintDetail,
  Paginated,
} from '@fixmycampus/shared';
import { useAuth } from '../auth';
import { download, params, pollOptions, post, request } from '../api';
import {
  ComplaintTable,
  date,
  Empty,
  Field,
  FileInput,
  FormError,
  Icon,
  Loading,
  PageHeading,
  PriorityBadge,
  slaLabel,
  StatusBadge,
  Success,
  validateFiles,
} from '../components';

export function useCatalog() {
  return useQuery({
    queryKey: ['catalog'],
    queryFn: () => request<Catalog>('/catalog'),
    staleTime: 30000,
  });
}
function useInvalidateComplaint() {
  const client = useQueryClient();
  return () =>
    Promise.all(
      ['complaint', 'complaints', 'dashboard', 'notifications', 'reports'].map((key) =>
        client.invalidateQueries({ queryKey: [key] }),
      ),
    );
}

export function ComplaintsPage() {
  const { user } = useAuth();
  const reporter = REPORTER_ROLES.includes(user!.role);
  const [search, setSearch] = useSearchParams();
  const catalog = useCatalog();
  const [text, setText] = useState(search.get('q') || '');
  const searchKey = search.toString();
  const query = useQuery({
    queryKey: ['complaints', searchKey],
    queryFn: () => request<Paginated<Complaint>>(`/complaints?${searchKey}`),
    ...pollOptions,
  });
  function filter(key: string, value: string) {
    setSearch(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set(key, value);
        else next.delete(key);
        next.delete('page');
        return next;
      },
      { replace: true },
    );
  }
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (text !== (search.get('q') || '')) filter('q', text);
    }, 300);
    return () => clearTimeout(timeout);
  }, [text]);
  const page = Number(search.get('page') || 1);
  const pageSize = query.data?.pageSize || 20;
  const pages = Math.max(1, Math.ceil((query.data?.total || 0) / pageSize));
  return (
    <>
      <PageHeading
        title={reporter ? 'My complaints' : 'Complaint queue'}
        description={
          reporter
            ? 'A record of what you reported and what’s happening next.'
            : user!.role === 'Department Officer'
              ? 'Your department’s assigned reports, ordered with urgent work first.'
              : 'Review reports, coordinate departments and follow campus-wide progress.'
        }
      >
        {reporter && (
          <Link to="/complaints/new" className="button primary">
            <Icon name="plus" size={19} />
            Report an issue
          </Link>
        )}
      </PageHeading>
      <div className="queue-tabs" role="group" aria-label="Quick status filters">
        {[
          { label: 'All complaints', value: '' },
          { label: 'Submitted', value: 'Submitted' },
          { label: 'In progress', value: 'In Progress' },
          { label: 'Resolved', value: 'Resolved' },
          { label: 'Returned', value: 'Returned' },
        ].map((tab) => (
          <button
            key={tab.value}
            className={
              (!search.get('status') ? '' : search.get('status')) === tab.value ? 'active' : ''
            }
            onClick={() => filter('status', tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <section className="panel queue-panel">
        <div className="queue-tools">
          <label className="search-input">
            <Icon name="search" size={19} />
            <input
              aria-label="Search complaints"
              placeholder="Search reference, description or location…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <span className="muted small">{query.data?.total ?? '—'} complaints</span>
        </div>
        <div className="queue-filters">
          <Field label="Category">
            <select
              value={search.get('categoryId') || ''}
              onChange={(e) => filter('categoryId', e.target.value)}
            >
              <option value="">All categories</option>
              {catalog.data?.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              value={search.get('status') || ''}
              onChange={(e) => filter('status', e.target.value)}
            >
              <option value="">All statuses</option>
              {STATUSES.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select
              value={search.get('priority') || ''}
              onChange={(e) => filter('priority', e.target.value)}
            >
              <option value="">All priorities</option>
              {PRIORITIES.map((priority) => (
                <option key={priority}>{priority}</option>
              ))}
            </select>
          </Field>
          {user!.role !== 'Department Officer' && (
            <Field label="Department">
              <select
                value={search.get('departmentId') || ''}
                onChange={(e) => filter('departmentId', e.target.value)}
              >
                <option value="">All departments</option>
                {catalog.data?.departments.map((dep) => (
                  <option key={dep.id} value={dep.id}>
                    {dep.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="From (IST)">
            <input
              type="date"
              value={search.get('from') || ''}
              max={search.get('to') || undefined}
              onChange={(e) => filter('from', e.target.value)}
            />
          </Field>
          <Field label="To (IST)">
            <input
              type="date"
              value={search.get('to') || ''}
              min={search.get('from') || undefined}
              onChange={(e) => filter('to', e.target.value)}
            />
          </Field>
          {search.size > 0 && (
            <button
              className="button quiet reset-filters"
              onClick={() => {
                setText('');
                setSearch({});
              }}
            >
              Reset
            </button>
          )}
        </div>
        <FormError error={query.error || catalog.error} />
        {query.isLoading ? <Loading /> : query.data && <ComplaintTable items={query.data.items} />}
        <div className="pagination">
          <span>
            {query.data?.total
              ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, query.data.total)} of ${query.data.total}`
              : '0 results'}
          </span>
          <div>
            <button
              className="button secondary small-button"
              disabled={page <= 1 || query.isFetching}
              onClick={() =>
                setSearch((previous) => {
                  const next = new URLSearchParams(previous);
                  next.set('page', String(page - 1));
                  return next;
                })
              }
            >
              Previous
            </button>
            <span>
              Page {page} of {pages}
            </span>
            <button
              className="button secondary small-button"
              disabled={page >= pages || query.isFetching}
              onClick={() =>
                setSearch((previous) => {
                  const next = new URLSearchParams(previous);
                  next.set('page', String(page + 1));
                  return next;
                })
              }
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

export function NewComplaintPage({ emergency = false }: { emergency?: boolean }) {
  const catalog = useCatalog();
  const navigate = useNavigate();
  const invalidate = useInvalidateComplaint();
  const [categoryId, setCategoryId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState('');
  const category = catalog.data?.categories.find((category) => category.id === Number(categoryId));
  function addFiles(selected: File[]) {
    const next = [...files, ...selected];
    const message = validateFiles(next);
    if (message) {
      setError(new Error(message));
      return;
    }
    setError(null);
    setFiles(next);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const values = new FormData(event.currentTarget);
    const parsed = complaintSchema.safeParse(Object.fromEntries(values));
    if (!parsed.success) {
      setError(new Error(parsed.error.issues[0].message));
      return;
    }
    const data = new FormData();
    Object.entries(parsed.data).forEach(([key, value]) => data.append(key, String(value)));
    files.forEach((file) => data.append('files', file));
    setBusy(true);
    try {
      const complaint = await request<ComplaintDetail>('/complaints', {
        method: 'POST',
        body: data,
      });
      await invalidate();
      navigate(`/complaints/${complaint.id}`, { state: { created: true } });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link to="/complaints" className="back-link">
        <Icon name="back" size={17} />
        My complaints
      </Link>
      <PageHeading
        title={emergency ? 'Report an urgent issue' : 'Report a campus issue'}
        description={
          emergency
            ? 'Urgent reports receive Critical priority and go directly to the responsible team and Campus Incharge.'
            : 'Tell us what needs attention. We’ll connect your report with the right team.'
        }
      />
      {emergency && (
        <div className="notice urgent">
          <Icon name="warning" />
          <div>
            <strong>Immediate routing for urgent concerns</strong>
            <p>
              If someone is in immediate danger, contact campus security or local emergency services
              directly.
            </p>
          </div>
        </div>
      )}
      {catalog.isLoading ? (
        <Loading />
      ) : (
        <div className="report-layout">
          <section className="panel report-form">
            <form className="stack-form" onSubmit={submit}>
              <FormError error={error || catalog.error} />
              <div className="form-section-heading">
                <span>1</span>
                <h2>What’s the issue?</h2>
              </div>
              <Field label="Issue category" required>
                <select
                  name="categoryId"
                  value={categoryId}
                  required
                  onChange={(e) => setCategoryId(e.target.value)}
                >
                  <option value="">Select an issue category</option>
                  {catalog.data?.categories
                    .filter((c) => c.active && (!emergency || c.emergency))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </Field>
              {category?.emergency && (
                <div className="notice urgent">
                  <Icon name="warning" />
                  <div>
                    <strong>Critical priority · Immediate routing</strong>
                    <p>
                      This report goes directly to{' '}
                      {category.departmentName || 'the responsible department'} and the Campus
                      Incharge.
                    </p>
                  </div>
                </div>
              )}
              <Field
                label="Location"
                required
                hint="Building, floor, room number, or a nearby landmark."
              >
                <input
                  name="location"
                  placeholder="e.g. Main building, second floor, Room 204"
                  minLength={2}
                  maxLength={255}
                  required
                />
              </Field>
              <Field
                label="Describe the issue"
                required
                hint={`${description.length} / 10,000 characters · Minimum 15 characters`}
              >
                <textarea
                  name="description"
                  rows={6}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What happened? Include details that will help the team understand and resolve it."
                  required
                  minLength={15}
                  maxLength={10000}
                />
              </Field>
              <div className="form-section-heading">
                <span>2</span>
                <h2>
                  Add supporting details <small>Optional</small>
                </h2>
              </div>
              <FileInput onChange={addFiles} remaining={5 - files.length} />
              {files.length > 0 && (
                <div className="selected-files">
                  {files.map((file, index) => (
                    <div key={`${file.name}-${index}`}>
                      <Icon name="file" size={16} />
                      <span>
                        {file.name}
                        <small>{(file.size / 1024 / 1024).toFixed(2)} MB</small>
                      </span>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Remove ${file.name}`}
                        onClick={() => setFiles(files.filter((_, i) => i !== index))}
                      >
                        <Icon name="close" size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {category?.confidential && (
                <label className="anonymous-option">
                  <input type="checkbox" name="anonymous" value="true" />
                  <span>
                    <strong>Submit anonymously</strong>
                    <span>
                      Your name and email will be hidden from the teams handling this report. You
                      can still track it from your account.
                    </span>
                  </span>
                  <Icon name="shield" size={22} />
                </label>
              )}
              <div className="form-actions">
                <Link className="button secondary" to="/complaints">
                  Cancel
                </Link>
                <button type="submit" className="button primary" disabled={busy || !catalog.data}>
                  {busy ? 'Submitting your report…' : 'Submit report'}
                  <Icon name="arrow" size={17} />
                </button>
              </div>
            </form>
          </section>
          <aside className="report-guidance">
            <div className="guidance-title">
              <Icon name="complaints" />
              <h2>What happens next</h2>
            </div>
            <ol className="report-steps">
              <li>
                <strong>Your report is received</strong>
                <p>You’ll get a unique reference to follow every update.</p>
              </li>
              <li>
                <strong>The right team takes it on</strong>
                <p>
                  {emergency
                    ? 'The responsible department and Campus Incharge are notified immediately.'
                    : 'Campus Incharge reviews and assigns the report. Critical issues are assigned immediately.'}
                </p>
              </li>
              <li>
                <strong>You stay in the loop</strong>
                <p>Check progress, see the resolution and share your feedback.</p>
              </li>
            </ol>
            <div className="privacy-note">
              <Icon name="shield" />
              <p>
                Confidential reports are shared only with you, Campus Incharge and the assigned
                department.
              </p>
            </div>
            <p className="muted small">
              If someone is in immediate danger, contact campus security or local emergency services
              directly.
            </p>
          </aside>
        </div>
      )}
    </>
  );
}

export function ComplaintDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const catalog = useCatalog();
  const invalidate = useInvalidateComplaint();
  const query = useQuery({
    queryKey: ['complaint', id],
    queryFn: () => request<ComplaintDetail>(`/complaints/${id}`),
    ...pollOptions,
  });
  const [fileError, setFileError] = useState<unknown>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const complaint = query.data;
  const mine = complaint?.reporter?.id === user!.id || REPORTER_ROLES.includes(user!.role);
  const officer = user!.role === 'Department Officer';
  const mutable = complaint && !['Resolved', 'Rejected'].includes(complaint.status);
  const uploadAllowed =
    mutable &&
    ((mine && complaint.status === 'Returned') ||
      (officer && ['Assigned', 'In Progress'].includes(complaint.status)));
  async function upload(files: File[]) {
    if (!complaint || !files.length) return;
    setFileError(null);
    const error = validateFiles(files, 5 - complaint.attachments.length);
    if (error) {
      setFileError(new Error(error));
      return;
    }
    setFileBusy(true);
    try {
      const data = new FormData();
      files.forEach((file) => data.append('files', file));
      data.append('kind', officer ? 'proof' : 'report');
      await request(`/complaints/${id}/attachments`, { method: 'POST', body: data });
      await invalidate();
    } catch (err) {
      setFileError(err);
    } finally {
      setFileBusy(false);
    }
  }
  async function getAttachment(attachmentId: number, name: string) {
    setFileError(null);
    try {
      await download(`/attachments/${attachmentId}`, name);
    } catch (err) {
      setFileError(err);
    }
  }
  if (query.isLoading) return <Loading label="Loading complaint details…" />;
  if (!complaint)
    return (
      <>
        <PageHeading title="Complaint details" />
        <FormError error={query.error} />
        <Link to="/complaints" className="button secondary">
          Back to complaints
        </Link>
      </>
    );
  return (
    <>
      <Link to="/complaints" className="back-link">
        <Icon name="back" size={17} />
        Back to complaints
      </Link>
      <PageHeading title={complaint.reference} description={complaint.categoryName}>
        <StatusBadge status={complaint.status} />
        <PriorityBadge priority={complaint.priority} />
      </PageHeading>
      <FormError error={query.error} />
      {complaint.confidential && (
        <div className="notice confidential">
          <Icon name="shield" />
          <span>
            <strong>Confidential report</strong> ·{' '}
            {complaint.anonymous
              ? 'Reporter identity is hidden. '
              : 'Shared with the reporter, Campus Incharge and assigned department only.'}
          </span>
        </div>
      )}
      <div className="detail-layout">
        <div className="detail-main">
          <section className="panel complaint-description">
            <div className="section-heading">
              <h2>Report details</h2>
              <span className="muted small">Submitted {date(complaint.createdAt)}</span>
            </div>
            <p className="preserve-lines">{complaint.description}</p>
            <div className="detail-meta">
              <div>
                <Icon name="location" size={18} />
                <span>
                  <small>Location</small>
                  <strong>{complaint.location}</strong>
                </span>
              </div>
              <div>
                <Icon name="user" size={18} />
                <span>
                  <small>Reported by</small>
                  <strong>
                    {complaint.anonymous
                      ? 'Anonymous reporter'
                      : complaint.reporter?.name || 'Identity unavailable'}
                  </strong>
                  {!complaint.anonymous && complaint.reporter?.email && (
                    <span className="muted small">{complaint.reporter.email}</span>
                  )}
                </span>
              </div>
            </div>
          </section>
          {complaint.resolutionSummary && (
            <section className="panel resolution-summary">
              <div className="section-heading">
                <h2>
                  <Icon name="check" />
                  Resolution summary
                </h2>
              </div>
              <p className="preserve-lines">{complaint.resolutionSummary}</p>
              {complaint.resolvedAt && (
                <p className="muted small">Resolved {date(complaint.resolvedAt)}</p>
              )}
            </section>
          )}
          <section className="panel">
            <div className="section-heading">
              <h2>Attachments & evidence</h2>
              <span className="muted small">{complaint.attachments.length} / 5 files</span>
            </div>
            <FormError error={fileError} />
            {complaint.attachments.length ? (
              <div className="attachments">
                {complaint.attachments.map((file) => (
                  <button
                    className="attachment"
                    key={file.id}
                    onClick={() => void getAttachment(file.id, file.name)}
                  >
                    <span className="attachment-icon">
                      <Icon name="file" size={23} />
                    </span>
                    <span>
                      <strong>{file.name}</strong>
                      <small>
                        {file.kind === 'proof' ? 'Resolution proof' : 'Report attachment'} ·{' '}
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </small>
                    </span>
                    <Icon name="download" size={18} />
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">No files attached to this report.</p>
            )}
            {uploadAllowed &&
              complaint.attachments.length < 5 &&
              (fileBusy ? (
                <Loading label="Uploading evidence…" />
              ) : (
                <FileInput
                  onChange={(files) => void upload(files)}
                  remaining={5 - complaint.attachments.length}
                />
              ))}
          </section>
          <section className="panel">
            <div className="section-heading">
              <h2>Activity timeline</h2>
              <span className="muted small">All times in IST</span>
            </div>
            <ol className="timeline">
              {[
                ...complaint.history.map((item) => ({
                  id: `h${item.id}`,
                  title: item.fromStatus ? `${item.fromStatus} → ${item.toStatus}` : item.toStatus,
                  body: item.note,
                  role: item.actorRole,
                  date: item.createdAt,
                  type: 'status',
                })),
                ...complaint.notes.map((item) => ({
                  id: `n${item.id}`,
                  title: 'Progress update',
                  body: item.note,
                  role: item.actorRole,
                  date: item.createdAt,
                  type: 'note',
                })),
                ...complaint.assignments.map((item) => ({
                  id: `a${item.id}`,
                  title: `Assigned to ${item.departmentName}`,
                  body: item.reason,
                  role: item.actorRole,
                  date: item.createdAt,
                  type: 'assignment',
                })),
              ]
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .map((entry) => (
                  <li key={entry.id}>
                    <span className={`timeline-marker ${entry.type}`}>
                      <Icon
                        name={
                          entry.type === 'note'
                            ? 'file'
                            : entry.type === 'assignment'
                              ? 'user'
                              : 'check'
                        }
                        size={14}
                      />
                    </span>
                    <div>
                      <h3>{entry.title}</h3>
                      {entry.body && <p className="preserve-lines">{entry.body}</p>}
                      <span className="muted small">
                        {entry.role} · {date(entry.date)}
                      </span>
                    </div>
                  </li>
                ))}
            </ol>
          </section>
          {mine && complaint.status === 'Resolved' && <FeedbackPanel complaint={complaint} />}
        </div>
        <aside className="detail-sidebar">
          <section className="panel sla-panel">
            <div className="section-heading">
              <h2>Service deadline</h2>
              <Icon name="clock" size={20} />
            </div>
            <strong className={slaLabel(complaint).includes('overdue') ? 'overdue' : ''}>
              {slaLabel(complaint)}
            </strong>
            <p className="muted small">{date(complaint.slaDueAt)}</p>
            <div className="sla-department">
              <small>Assigned department</small>
              <strong>{complaint.departmentName || 'Awaiting assignment'}</strong>
            </div>
            {complaint.escalatedAt && (
              <div className="notice urgent">
                <Icon name="warning" size={17} />
                <span>Escalated {date(complaint.escalatedAt)}</span>
              </div>
            )}
          </section>
          <ActionPanel complaint={complaint} catalog={catalog.data} />
          {complaint.feedback && (
            <section className="panel">
              <h2>Reporter feedback</h2>
              <div className="feedback-rating">
                {complaint.feedback.rating}
                <span>/ 5</span>
              </div>
              <p className="preserve-lines">
                {complaint.feedback.comment || 'No written feedback.'}
              </p>
              <span className="muted small">{date(complaint.feedback.createdAt)}</span>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

function ActionPanel({ complaint, catalog }: { complaint: ComplaintDetail; catalog?: Catalog }) {
  const { user } = useAuth();
  const [action, setAction] = useState('');
  const [success, setSuccess] = useState('');
  const invalidate = useInvalidateComplaint();
  const actions: { value: ComplaintAction['action']; label: string }[] = [];
  const active = !['Resolved', 'Rejected'].includes(complaint.status);
  if (user!.role === 'Campus Incharge' && active) {
    if (complaint.status === 'Submitted') actions.push({ value: 'verify', label: 'Verify report' });
    if (['Submitted', 'Verified'].includes(complaint.status))
      actions.push({ value: 'return', label: 'Return for more information' });
    if (['Submitted', 'Verified', 'Returned'].includes(complaint.status))
      actions.push({ value: 'reject', label: 'Reject report' });
    if (['Verified', 'Assigned', 'In Progress'].includes(complaint.status))
      actions.push({
        value: 'assign',
        label: complaint.departmentId ? 'Reassign department' : 'Assign department',
      });
    if (!complaint.emergency) actions.push({ value: 'priority', label: 'Change priority' });
    actions.push({ value: 'escalate', label: 'Escalate complaint' });
  }
  if (user!.role === 'Department Officer' && complaint.departmentId === user!.departmentId) {
    if (complaint.status === 'Assigned') actions.push({ value: 'start', label: 'Start work' });
    if (complaint.status === 'In Progress')
      actions.push(
        { value: 'progress', label: 'Add progress update' },
        { value: 'resolve', label: 'Mark as resolved' },
      );
  }
  if (REPORTER_ROLES.includes(user!.role)) {
    if (complaint.status === 'Returned')
      actions.push({ value: 'resubmit', label: 'Correct and resubmit' });
    if (
      complaint.status === 'Resolved' &&
      complaint.resolvedAt &&
      Date.now() - new Date(complaint.resolvedAt).getTime() <= 72 * 3600000
    )
      actions.push({ value: 'reopen', label: 'Reopen complaint' });
  }
  const current = actions.find((item) => item.value === action)?.value || actions[0]?.value || '';
  const mutation = useMutation({
    mutationFn: (data: ComplaintAction) => post(`/complaints/${complaint.id}/actions`, data),
    onSuccess: async () => {
      setSuccess('Complaint updated.');
      await invalidate();
    },
    onError: async () => {
      await invalidate();
    },
  });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSuccess('');
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const data: ComplaintAction = {
      action: current as ComplaintAction['action'],
      version: complaint.version,
    };
    for (const key of ['reason', 'note', 'summary', 'description', 'location'] as const)
      if (values[key]) data[key] = String(values[key]);
    if (values.departmentId) data.departmentId = Number(values.departmentId);
    if (values.categoryId) data.categoryId = Number(values.categoryId);
    if (values.priority) data.priority = values.priority as ComplaintAction['priority'];
    await mutation.mutateAsync(data).catch(() => {});
  }
  if (!actions.length) return null;
  return (
    <section className="panel action-panel">
      <div className="section-heading">
        <h2>
          {user!.role === 'Campus Incharge'
            ? 'Manage complaint'
            : current === 'reopen'
              ? 'Need more help?'
              : 'Next action'}
        </h2>
      </div>
      <FormError error={mutation.error} />
      {success && <Success>{success}</Success>}
      <form className="stack-form" onSubmit={(event) => void submit(event)}>
        <Field label="Action">
          <select
            value={current}
            onChange={(e) => {
              setAction(e.target.value);
              setSuccess('');
              mutation.reset();
            }}
          >
            {actions.map((item) => (
              <option value={item.value} key={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
        {current === 'assign' && (
          <Field label="Department" required>
            <select
              name="departmentId"
              defaultValue={
                complaint.departmentId ||
                catalog?.categories.find((c) => c.id === complaint.categoryId)?.departmentId ||
                ''
              }
              required
            >
              {catalog?.departments
                .filter((dep) => dep.active)
                .map((dep) => (
                  <option key={dep.id} value={dep.id}>
                    {dep.name}
                  </option>
                ))}
            </select>
          </Field>
        )}
        {current === 'priority' && (
          <Field label="Priority" required>
            <select name="priority" defaultValue={complaint.priority}>
              {PRIORITIES.map((priority) => (
                <option key={priority}>{priority}</option>
              ))}
            </select>
          </Field>
        )}
        {['return', 'reject', 'assign', 'priority', 'escalate', 'reopen'].includes(current) && (
          <Field label={current === 'reopen' ? 'What still needs attention?' : 'Reason'} required>
            <textarea
              name="reason"
              rows={3}
              required
              minLength={current === 'reopen' ? 10 : 1}
              maxLength={2000}
            />
          </Field>
        )}
        {current === 'progress' && (
          <Field label="Progress update" required>
            <textarea name="note" required minLength={5} maxLength={5000} rows={4} />
          </Field>
        )}
        {current === 'resolve' && (
          <>
            <Field
              label="Resolution summary"
              required
              hint="Describe what was fixed. Minimum 10 characters."
            >
              <textarea name="summary" rows={4} required minLength={10} maxLength={5000} />
            </Field>
            <p className="muted small">
              Add resolution proof in Attachments & evidence before resolving.
            </p>
          </>
        )}
        {current === 'resubmit' && (
          <>
            <p className="muted small">
              Category: {complaint.categoryName}. Update the location and details requested by
              Campus Incharge.
            </p>
            <Field label="Location" required>
              <input
                name="location"
                defaultValue={complaint.location}
                required
                minLength={2}
                maxLength={255}
              />
            </Field>
            <Field label="Updated description" required>
              <textarea
                name="description"
                rows={5}
                defaultValue={complaint.description}
                required
                minLength={15}
                maxLength={10000}
              />
            </Field>
          </>
        )}
        {current === 'reopen' && (
          <p className="muted small">
            You can reopen within 72 hours of resolution. A new service deadline begins when
            reopened.
          </p>
        )}
        {['return', 'reject'].includes(current) && (
          <p className="muted small">
            Your reason will be visible to the reporter and recorded in the timeline.
          </p>
        )}
        <button
          type="submit"
          className={`button ${current === 'reject' ? 'danger' : 'primary'} full-width`}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? 'Updating…' : actions.find((item) => item.value === current)?.label}
          <Icon name="arrow" size={17} />
        </button>
      </form>
    </section>
  );
}

function FeedbackPanel({ complaint }: { complaint: ComplaintDetail }) {
  const invalidate = useInvalidateComplaint();
  const [rating, setRating] = useState(0);
  const mutation = useMutation({
    mutationFn: (data: { rating: number; comment: string }) =>
      post(`/complaints/${complaint.id}/feedback`, data),
    onSuccess: invalidate,
  });
  if (complaint.feedback) return null;
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>How was the resolution?</h2>
          <p className="muted small">
            Your feedback helps improve campus services. Submitted ratings can’t be edited.
          </p>
        </div>
      </div>
      <FormError error={mutation.error} />
      <form
        className="stack-form"
        onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          mutation.mutate({ rating, comment: String(values.get('comment') || '') });
        }}
      >
        <fieldset className="rating-field">
          <legend>Rate your experience</legend>
          <div className="rating-options">
            {[1, 2, 3, 4, 5].map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="rating"
                  value={value}
                  checked={rating === value}
                  onChange={() => setRating(value)}
                  required
                />
                <span>
                  {value}
                  <small>{['Poor', 'Fair', 'Good', 'Very good', 'Excellent'][value - 1]}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Tell us more (optional)">
          <textarea
            name="comment"
            maxLength={2000}
            rows={3}
            placeholder="What worked well? What could be better?"
          />
        </Field>
        <div>
          <button className="button primary" type="submit" disabled={!rating || mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Submit feedback'}
          </button>
        </div>
      </form>
    </section>
  );
}
