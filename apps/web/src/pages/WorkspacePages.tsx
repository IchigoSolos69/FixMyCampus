import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AppNotification, Dashboard, Report, User } from '@fixmycampus/shared';
import { REPORTER_ROLES } from '@fixmycampus/shared';
import { useAuth } from '../auth';
import { download, params, patch, pollOptions, post, request } from '../api';
import {
  ComplaintTable,
  date,
  Empty,
  Field,
  FormError,
  hours,
  Icon,
  Loading,
  PageHeading,
  Success,
} from '../components';

export function DashboardPage() {
  const { user } = useAuth();
  const reporter = REPORTER_ROLES.includes(user!.role);
  const administrator = user!.role === 'Administrator';
  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => request<Dashboard>('/dashboard'),
    ...pollOptions,
  });
  const officer = user!.role === 'Department Officer';
  const workload = officer
    ? ['Critical', 'High', 'Medium', 'Low'].map((priority) => ({
        label: priority,
        count: query.data?.countsByPriority.find((row) => row.priority === priority)?.count || 0,
      }))
    : (query.data?.countsByStatus || []).map((row) => ({ label: row.status, count: row.count }));
  return (
    <>
      <PageHeading
        title={reporter ? `Hello, ${user!.name.split(' ')[0]}.` : 'Campus overview'}
        description={
          reporter
            ? 'Here’s where your reports stand. Every issue is a step toward a better campus.'
            : user!.role === 'Department Officer'
              ? `${user!.departmentName || 'Your department'} · Assigned work, deadlines and recent activity.`
              : 'Keep campus services moving. Prioritize urgent issues and follow every resolution.'
        }
      >
        {reporter ? (
          <Link className="button primary" to="/complaints/new">
            <Icon name="plus" size={19} />
            Report an issue
          </Link>
        ) : (
          <Link className="button primary" to={administrator ? '/reports' : '/complaints'}>
            {administrator ? 'View service reports' : 'Open complaint queue'}
            <Icon name="arrow" size={18} />
          </Link>
        )}
      </PageHeading>
      <FormError error={query.error} />
      {query.isLoading && <Loading />}
      {query.data && (
        <>
          <div className="metrics-strip">
            {[
              {
                label: reporter ? 'Your reports' : 'Total complaints',
                value: query.data.total,
                icon: 'complaints',
                link: '',
              },
              {
                label: 'Open & in progress',
                value: query.data.open,
                icon: 'clock',
                link: '?status=In+Progress',
              },
              {
                label: 'Resolved',
                value: query.data.resolved,
                icon: 'check',
                link: '?status=Resolved',
              },
              {
                label: 'Past service deadline',
                value: query.data.overdue,
                icon: 'warning',
                link: '',
                alert: query.data.overdue > 0,
              },
            ].map((metric) => (
              <Link
                key={metric.label}
                className={`metric${metric.alert ? ' metric-alert' : ''}`}
                to={administrator ? '/reports' : `/complaints${metric.link}`}
              >
                <span className="metric-label">
                  {metric.label}
                  <Icon name={metric.icon} size={18} />
                </span>
                <strong>{metric.value}</strong>
                <span className="metric-detail">
                  {administrator ? 'View service reports' : 'View complaints'}
                  <Icon name="arrow" size={14} />
                </span>
              </Link>
            ))}
          </div>
          {reporter ? (
            <div className="service-note">
              <span className="service-note-icon">
                <Icon name="campus" size={26} />
              </span>
              <div>
                <h2>Something on campus needs attention?</h2>
                <p>Tell us what happened and where. Your report goes to the team that can help.</p>
              </div>
              <Link to="/complaints/new" className="button secondary">
                Make a report
                <Icon name="arrow" size={16} />
              </Link>
            </div>
          ) : (
            <div className="dashboard-two">
              <section className="panel">
                <div className="section-heading">
                  <h2>{officer ? 'Work by priority' : 'Work by status'}</h2>
                  <span className="muted small">Current workload</span>
                </div>
                <div className="status-chart">
                  {workload.map((row) => (
                    <div className="bar-row" key={row.label}>
                      <span>{row.label}</span>
                      <div className="bar-track">
                        <div
                          style={{
                            width: `${Math.max(1, (row.count / Math.max(1, query.data!.total)) * 100)}%`,
                          }}
                        />
                      </div>
                      <strong>{row.count}</strong>
                    </div>
                  ))}
                </div>
              </section>
              <section className="panel resolution-panel">
                <span className="panel-icon">
                  <Icon name="clock" size={23} />
                </span>
                <h2>Resolution time</h2>
                <div className="resolution-stat">
                  <strong>{hours(query.data.averageResolutionHours)}</strong>
                  <span>Average time to resolve</span>
                </div>
                <div className="resolution-median">
                  <span>Median resolution time</span>
                  <strong>{hours(query.data.medianResolutionHours)}</strong>
                </div>
                <Link to={user!.role === 'Department Officer' ? '/complaints' : '/reports'}>
                  {user!.role === 'Department Officer'
                    ? 'View assigned complaints'
                    : 'Explore service performance'}
                  <Icon name="arrow" size={16} />
                </Link>
              </section>
            </div>
          )}
          {!administrator && (
            <section className="panel recent-panel">
              <div className="section-heading">
                <div>
                  <h2>{reporter ? 'Your latest reports' : 'Recent complaints'}</h2>
                  <p className="muted small">
                    {reporter
                      ? 'Follow updates from your campus service teams.'
                      : 'Latest reports across your accessible workspace.'}
                  </p>
                </div>
                <Link to="/complaints" className="text-link">
                  View all
                  <Icon name="arrow" size={16} />
                </Link>
              </div>
              <ComplaintTable items={query.data.recent} compact />
            </section>
          )}
          {!reporter && query.data.departments.length > 0 && (
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Department performance</h2>
                  <p className="muted small">Resolution cycles and feedback for your workspace.</p>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Department</th>
                      <th>Complaints</th>
                      <th>Average resolution</th>
                      <th>Rating</th>
                      <th>SLA compliance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.departments.map((dep) => (
                      <tr key={dep.id}>
                        <td>
                          <strong>{dep.name}</strong>
                          {dep.flagged && (
                            <span className="flag-label">
                              <Icon name="warning" size={14} />
                              Two-week SLA trend
                            </span>
                          )}
                        </td>
                        <td>{dep.count}</td>
                        <td>{hours(dep.averageHours)}</td>
                        <td>
                          {dep.averageRating == null
                            ? 'No ratings'
                            : `${Number(dep.averageRating).toFixed(1)} / 5`}
                        </td>
                        <td>
                          {dep.slaCompliance == null
                            ? '—'
                            : `${Number(dep.slaCompliance).toFixed(0)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}

export function NotificationsPage() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['notifications'],
    queryFn: () => request<{ items: AppNotification[]; unread: number }>('/notifications'),
    ...pollOptions,
  });
  const mutation = useMutation({
    mutationFn: (id?: number) => post('/notifications/read', id ? { id } : {}),
    onSuccess: () => client.invalidateQueries({ queryKey: ['notifications'] }),
  });
  return (
    <>
      <PageHeading
        title="Notifications"
        description="Assignment updates, progress notes and service deadline alerts."
      >
        <button
          className="button secondary"
          disabled={mutation.isPending || !query.data?.unread}
          onClick={() => mutation.mutate(undefined)}
        >
          <Icon name="check" size={18} />
          Mark all as read
        </button>
      </PageHeading>
      <FormError error={query.error || mutation.error} />
      {query.isLoading ? (
        <Loading />
      ) : (
        <section className="panel notification-list">
          {query.data?.items.length ? (
            query.data.items.map((item) => (
              <article key={item.id} className={`notification-item${item.readAt ? '' : ' unread'}`}>
                <span className="notification-symbol">
                  <Icon name={item.title.toLowerCase().includes('escalat') ? 'warning' : 'bell'} />
                </span>
                <div>
                  <h2>
                    {item.title}
                    {!item.readAt && <span className="unread-dot" aria-label="Unread" />}
                  </h2>
                  <p>{item.body}</p>
                  <span className="muted small">{date(item.createdAt)}</span>
                  {item.complaintId && (
                    <Link to={`/complaints/${item.complaintId}`} className="text-link">
                      View complaint
                      <Icon name="arrow" size={14} />
                    </Link>
                  )}
                </div>
                {!item.readAt && (
                  <button
                    className="icon-button"
                    aria-label={`Mark ${item.title} as read`}
                    disabled={mutation.isPending}
                    onClick={() => mutation.mutate(item.id)}
                  >
                    <Icon name="check" size={18} />
                  </button>
                )}
              </article>
            ))
          ) : (
            <Empty title="You’re all caught up">
              Updates about your complaints will appear here.
            </Empty>
          )}
        </section>
      )}
    </>
  );
}

export function ReportsPage() {
  const { user } = useAuth();
  const administrator = user!.role === 'Administrator';
  const [type, setType] = useState<Report['type']>(administrator ? 'department' : 'category');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [exporting, setExporting] = useState('');
  const queryString = params({ type, from, to });
  const query = useQuery({
    queryKey: ['reports', queryString],
    queryFn: () => request<Report>(`/reports?${queryString}`),
  });
  async function exportReport(format: string) {
    setExporting(format);
    setError(null);
    try {
      await download(
        `/reports/export?${queryString}&format=${format}`,
        `FixMyCampus-${type}.${format}`,
      );
    } catch (err) {
      setError(err);
    } finally {
      setExporting('');
    }
  }
  const total = query.data?.rows.reduce((sum, row) => sum + row.count, 0) || 0;
  return (
    <>
      <PageHeading
        title="Reports & insights"
        description={
          administrator
            ? 'See where issues occur and how campus services respond.'
            : 'Read-only campus complaint summary by issue category.'
        }
      >
        {administrator && (
          <>
            <button
              className="button secondary"
              disabled={!!exporting || !query.data}
              onClick={() => void exportReport('csv')}
            >
              <Icon name="download" size={17} />
              {exporting === 'csv' ? 'Exporting…' : 'Export CSV'}
            </button>
            <button
              className="button primary"
              disabled={!!exporting || !query.data}
              onClick={() => void exportReport('pdf')}
            >
              <Icon name="file" size={17} />
              {exporting === 'pdf' ? 'Exporting…' : 'Export PDF'}
            </button>
          </>
        )}
      </PageHeading>
      <div className="panel report-filters">
        <Field label="Group by">
          <select value={type} onChange={(e) => setType(e.target.value as Report['type'])}>
            <option value="category">Issue category</option>
            {administrator && (
              <>
                <option value="department">Department</option>
                <option value="status">Complaint status</option>
                <option value="sla">SLA compliance</option>
              </>
            )}
          </select>
        </Field>
        <Field label="From date (IST)">
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="To date (IST)">
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <button
          className="button quiet"
          onClick={() => {
            setFrom('');
            setTo('');
          }}
        >
          Reset dates
        </button>
      </div>
      <FormError error={query.error || error} />
      {query.isLoading ? (
        <Loading />
      ) : (
        query.data && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>{type === 'sla' ? 'Service deadline compliance' : `Complaints by ${type}`}</h2>
                <p className="muted small">
                  {from || 'All time'}
                  {to ? ` to ${to}` : ''} · {total} complaints
                </p>
              </div>
            </div>
            {query.data.rows.length ? (
              <>
                <div className="report-bars">
                  {query.data.rows
                    .filter((row) => row.count > 0)
                    .slice(0, 12)
                    .map((row) => (
                      <div className="bar-row" key={row.label}>
                        <span>{row.label}</span>
                        <div className="bar-track">
                          <div
                            style={{
                              width: `${Math.max(1, (row.count / Math.max(total, 1)) * 100)}%`,
                            }}
                          />
                        </div>
                        <strong>{row.count}</strong>
                      </div>
                    ))}
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>
                          {type === 'sla' ? 'SLA group' : type[0].toUpperCase() + type.slice(1)}
                        </th>
                        <th>Complaints</th>
                        <th>Resolved</th>
                        <th>Average resolution</th>
                        <th>SLA compliance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {query.data.rows.map((row) => (
                        <tr key={row.label}>
                          <td>
                            <strong>{row.label}</strong>
                          </td>
                          <td>{row.count}</td>
                          <td>{row.resolved}</td>
                          <td>{hours(row.averageHours)}</td>
                          <td>
                            {row.slaCompliance == null
                              ? '—'
                              : `${Number(row.slaCompliance).toFixed(1)}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <Empty title="No report data in this period">
                Choose a different date range to see service performance.
              </Empty>
            )}
          </section>
        )
      )}
    </>
  );
}

export function ProfilePage() {
  const { user, update, logout } = useAuth();
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoVersion, setPhotoVersion] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    if (!user?.photoUrl) return;
    let url = '';
    let active = true;
    request<Blob>('/profile/photo')
      .then((blob) => {
        url = URL.createObjectURL(blob);
        if (active) setPhotoUrl(url);
        else URL.revokeObjectURL(url);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [user?.photoUrl, photoVersion]);
  async function save(event: FormEvent<HTMLFormElement>, kind: 'profile' | 'password') {
    event.preventDefault();
    setBusy(kind);
    setError(null);
    setSuccess('');
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try {
      if (kind === 'profile') {
        update(await patch<User>('/profile', values));
        setSuccess('Your profile has been updated.');
      } else {
        if (values.newPassword !== values.confirmPassword)
          throw new Error('The new passwords do not match.');
        await post('/profile/password', {
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        });
        form.reset();
        await logout();
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy('');
    }
  }
  async function photo(file: File | undefined) {
    if (!file) return;
    setError(null);
    setSuccess('');
    if (file.size > 10 * 1024 * 1024 || !['image/png', 'image/jpeg'].includes(file.type)) {
      setError(new Error('Choose a JPEG or PNG photo no larger than 10 MB.'));
      return;
    }
    setBusy('photo');
    try {
      const data = new FormData();
      data.append('photo', file);
      update(await request<User>('/profile/photo', { method: 'POST', body: data }));
      setPhotoVersion((value) => value + 1);
      setSuccess('Profile photo updated.');
    } catch (err) {
      setError(err);
    } finally {
      setBusy('');
    }
  }
  return (
    <>
      <PageHeading
        title="Your account"
        description="Keep your contact details current and your campus account secure."
      />
      <FormError error={error} />
      {success && <Success>{success}</Success>}
      <div className="profile-layout">
        <section className="panel profile-summary">
          <span className="avatar profile-avatar">
            {photoUrl ? (
              <img src={photoUrl} alt="Your profile" />
            ) : (
              user!.name
                .split(' ')
                .map((x) => x[0])
                .slice(0, 2)
                .join('')
            )}
          </span>
          <h2>{user!.name}</h2>
          <p className="muted">{user!.email}</p>
          <span className="role-label">{user!.role}</span>
          {user!.departmentName && <p>{user!.departmentName}</p>}
          <label className="button secondary photo-button">
            {busy === 'photo' ? 'Uploading…' : 'Change photo'}
            <input
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              disabled={!!busy}
              onChange={(e) => void photo(e.target.files?.[0])}
            />
          </label>
          <p className="muted small">Member since {date(user!.createdAt, false)}</p>
        </section>
        <div>
          <section className="panel">
            <div className="section-heading">
              <h2>Profile details</h2>
            </div>
            <form onSubmit={(event) => void save(event, 'profile')} className="stack-form">
              <Field label="Full name" required>
                <input
                  name="name"
                  defaultValue={user!.name}
                  minLength={2}
                  maxLength={120}
                  required
                  autoComplete="name"
                />
              </Field>
              <Field label="Contact number">
                <input
                  name="contactNumber"
                  type="tel"
                  defaultValue={user!.contactNumber || ''}
                  maxLength={30}
                  autoComplete="tel"
                />
              </Field>
              <Field label="Department, class or affiliation">
                <input name="affiliation" defaultValue={user!.affiliation || ''} maxLength={160} />
              </Field>
              <div>
                <button type="submit" className="button primary" disabled={!!busy}>
                  {busy === 'profile' ? 'Saving…' : 'Save profile'}
                </button>
              </div>
            </form>
          </section>
          <section className="panel">
            <div className="section-heading">
              <h2>Change password</h2>
            </div>
            <form onSubmit={(event) => void save(event, 'password')} className="stack-form">
              <Field label="Current password" required>
                <input
                  name="currentPassword"
                  type="password"
                  required
                  autoComplete="current-password"
                />
              </Field>
              <Field
                label="New password"
                required
                hint="At least 12 characters, uppercase, lowercase, a number and a symbol."
              >
                <input
                  name="newPassword"
                  type="password"
                  minLength={12}
                  maxLength={128}
                  required
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Confirm new password" required>
                <input
                  name="confirmPassword"
                  type="password"
                  minLength={12}
                  maxLength={128}
                  required
                  autoComplete="new-password"
                />
              </Field>
              <div>
                <button type="submit" className="button secondary" disabled={!!busy}>
                  {busy === 'password' ? 'Updating…' : 'Update password'}
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </>
  );
}
