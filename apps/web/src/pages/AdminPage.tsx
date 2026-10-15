import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PRIORITIES, ROLES } from '@fixmycampus/shared';
import type { Category, Department, Paginated, Priority, User } from '@fixmycampus/shared';
import { params, patch, post, request } from '../api';
import { Empty, Field, FormError, Icon, Loading, PageHeading, Success } from '../components';

type AdminTab = 'users' | 'departments' | 'categories' | 'settings';
type Settings = {
  sla: Record<Priority, number>;
  emailTemplates: { event: string; subject: string; body: string }[];
};
export function AdminPage() {
  const [tab, setTab] = useState<AdminTab>('users');
  const client = useQueryClient();
  const departments = useQuery({
    queryKey: ['admin', 'departments'],
    queryFn: () => request<{ items: Department[] }>('/admin/departments'),
  });
  const invalidate = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ['admin'] }),
      client.invalidateQueries({ queryKey: ['catalog'] }),
      client.invalidateQueries({ queryKey: ['dashboard'] }),
    ]);
  return (
    <>
      <PageHeading
        title="Administration"
        description="Manage campus accounts, routing and service standards."
      />
      <div className="queue-tabs" role="group" aria-label="Administration sections">
        {(
          [
            { id: 'users', label: 'People & access' },
            { id: 'departments', label: 'Departments' },
            { id: 'categories', label: 'Issue categories' },
            { id: 'settings', label: 'SLA & email' },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? 'active' : ''}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <FormError error={departments.error} />
      {tab === 'users' ? (
        <UsersPanel departments={departments.data?.items || []} invalidate={invalidate} />
      ) : tab === 'departments' ? (
        <DepartmentsPanel
          departments={departments.data?.items || []}
          loading={departments.isLoading}
          invalidate={invalidate}
        />
      ) : tab === 'categories' ? (
        <CategoriesPanel departments={departments.data?.items || []} invalidate={invalidate} />
      ) : (
        <SettingsPanel />
      )}
    </>
  );
}
function UsersPanel({
  departments,
  invalidate,
}: {
  departments: Department[];
  invalidate: () => Promise<unknown>;
}) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<User | null>(null);
  const [success, setSuccess] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(text);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [text]);
  const result = useQuery({
    queryKey: ['admin', 'users', query, role, page],
    queryFn: () =>
      request<Paginated<User>>(`/admin/users?${params({ q: query, role, page, pageSize: 20 })}`),
  });
  const mutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: unknown }) =>
      patch<User>(`/admin/users/${id}`, data),
    onSuccess: async () => {
      setSelected(null);
      setSuccess(
        'Account access updated. Existing sessions are invalidated when security settings change.',
      );
      await invalidate();
    },
  });
  return (
    <>
      <FormError error={result.error || mutation.error} />
      {success && <Success>{success}</Success>}
      {selected && (
        <section className="panel edit-user">
          <div className="section-heading">
            <div>
              <h2>Edit {selected.name}</h2>
              <p className="muted small">{selected.email}</p>
            </div>
            <button
              className="icon-button"
              aria-label="Close account editor"
              onClick={() => {
                setSelected(null);
                mutation.reset();
              }}
            >
              <Icon name="close" />
            </button>
          </div>
          <UserEditor
            key={selected.id}
            user={selected}
            departments={departments}
            busy={mutation.isPending}
            onSave={(data) => mutation.mutate({ id: selected.id, data })}
          />
        </section>
      )}
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Campus accounts</h2>
            <p className="muted small">
              Operational roles are granted here. Department officers must belong to one active
              department.
            </p>
          </div>
          <span className="muted small">{result.data?.total || 0} accounts</span>
        </div>
        <div className="queue-tools">
          <label className="search-input">
            <Icon name="search" size={18} />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Search name or email…"
              aria-label="Search accounts"
            />
          </label>
          <select
            aria-label="Filter by role"
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All roles</option>
            {ROLES.map((role) => (
              <option key={role}>{role}</option>
            ))}
          </select>
        </div>
        {result.isLoading ? (
          <Loading />
        ) : result.data?.items.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name & email</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Account status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {result.data.items.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.name}</strong>
                      <span className="muted small block">{user.email}</span>
                    </td>
                    <td>{user.role}</td>
                    <td>{user.departmentName || '—'}</td>
                    <td>
                      <span
                        className={`badge ${user.active ? 'status-resolved' : 'status-rejected'}`}
                      >
                        <span className="status-dot" />
                        {user.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <button
                        className="button secondary small-button"
                        onClick={() => {
                          setSelected(user);
                          setSuccess('');
                          mutation.reset();
                        }}
                      >
                        Edit access
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No matching accounts">Try another name, email or role.</Empty>
        )}
        <div className="pagination">
          <span>
            Page {page} of {Math.max(1, Math.ceil((result.data?.total || 0) / 20))}
          </span>
          <div>
            <button
              className="button secondary small-button"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <button
              className="button secondary small-button"
              disabled={page * 20 >= (result.data?.total || 0)}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
function UserEditor({
  user,
  departments,
  busy,
  onSave,
}: {
  user: User;
  departments: Department[];
  busy: boolean;
  onSave: (data: unknown) => void;
}) {
  const [role, setRole] = useState(user.role);
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    onSave({
      name: data.name,
      role,
      active: data.active === 'true',
      departmentId: role === 'Department Officer' ? Number(data.departmentId) : null,
    });
  }
  return (
    <form className="admin-inline-form" onSubmit={save}>
      <Field label="Full name" required>
        <input name="name" defaultValue={user.name} minLength={2} maxLength={120} required />
      </Field>
      <Field label="Role" required>
        <select value={role} onChange={(e) => setRole(e.target.value as User['role'])}>
          {ROLES.map((role) => (
            <option key={role}>{role}</option>
          ))}
        </select>
      </Field>
      <Field label="Account status">
        <select name="active" defaultValue={String(user.active)}>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </Field>
      {role === 'Department Officer' && (
        <Field label="Department" required>
          <select name="departmentId" defaultValue={user.departmentId || ''} required>
            <option value="">Select one department</option>
            {departments
              .filter((dep) => dep.active)
              .map((dep) => (
                <option key={dep.id} value={dep.id}>
                  {dep.name}
                </option>
              ))}
          </select>
        </Field>
      )}
      <button type="submit" className="button primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save account'}
      </button>
    </form>
  );
}
function DepartmentsPanel({
  departments,
  loading,
  invalidate,
}: {
  departments: Department[];
  loading: boolean;
  invalidate: () => Promise<unknown>;
}) {
  const [success, setSuccess] = useState('');
  const [edit, setEdit] = useState<number | null>(null);
  const mutation = useMutation({
    mutationFn: ({ id, data }: { id?: number; data: unknown }) =>
      id ? patch(`/admin/departments/${id}`, data) : post('/admin/departments', data),
    onSuccess: async () => {
      setSuccess('Department saved.');
      setEdit(null);
      await invalidate();
    },
  });
  function submit(event: FormEvent<HTMLFormElement>, id?: number) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    mutation.mutate(
      { id, data: { name: values.name, ...(id ? { active: values.active === 'true' } : {}) } },
      {
        onSuccess: () => {
          if (!id) form.reset();
        },
      },
    );
  }
  return (
    <>
      <FormError error={mutation.error} />
      {success && <Success>{success}</Success>}
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Departments</h2>
            <p className="muted small">
              Manage the campus teams responsible for resolving complaints.
            </p>
          </div>
          <span className="muted small">{departments.length} departments</span>
        </div>
        <form className="add-row" onSubmit={(e) => submit(e)}>
          <Field label="New department name" required>
            <input
              name="name"
              placeholder="Department name"
              minLength={2}
              maxLength={160}
              required
            />
          </Field>
          <button className="button primary" disabled={mutation.isPending}>
            <Icon name="plus" size={17} />
            Add department
          </button>
        </form>
        {loading ? (
          <Loading />
        ) : (
          <div className="admin-rows">
            {departments.map((dep) => (
              <div className="admin-row" key={dep.id}>
                {edit === dep.id ? (
                  <form className="edit-routing-form" onSubmit={(e) => submit(e, dep.id)}>
                    <Field label="Department name" required>
                      <input
                        name="name"
                        defaultValue={dep.name}
                        minLength={2}
                        maxLength={160}
                        required
                      />
                    </Field>
                    <Field label="Status">
                      <select name="active" defaultValue={String(dep.active)}>
                        <option value="true">Active</option>
                        <option value="false">Inactive</option>
                      </select>
                    </Field>
                    <button className="button primary" disabled={mutation.isPending}>
                      Save
                    </button>
                    <button className="button quiet" type="button" onClick={() => setEdit(null)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <div>
                      <strong>{dep.name}</strong>
                      <span className="muted small block">
                        {dep.active ? 'Accepting assignments' : 'Inactive'}
                      </span>
                    </div>
                    <button
                      className="button secondary small-button"
                      onClick={() => {
                        setEdit(dep.id);
                        setSuccess('');
                        mutation.reset();
                      }}
                    >
                      Edit
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      <p className="muted small admin-footnote">
        Departments with active categories or assigned officers must be reassigned before
        deactivation.
      </p>
    </>
  );
}
function CategoriesPanel({
  departments,
  invalidate,
}: {
  departments: Department[];
  invalidate: () => Promise<unknown>;
}) {
  const query = useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: () => request<{ items: Category[] }>('/admin/categories'),
  });
  const [edit, setEdit] = useState<number | null>(null);
  const [success, setSuccess] = useState('');
  const mutation = useMutation({
    mutationFn: ({ id, data }: { id?: number; data: unknown }) =>
      id ? patch(`/admin/categories/${id}`, data) : post('/admin/categories', data),
    onSuccess: async () => {
      setEdit(null);
      setSuccess('Category routing saved.');
      await invalidate();
    },
  });
  function submit(event: FormEvent<HTMLFormElement>, id?: number) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    mutation.mutate(
      {
        id,
        data: {
          name: values.name,
          departmentId: Number(values.departmentId),
          ...(id ? { active: values.active === 'true' } : {}),
        },
      },
      {
        onSuccess: () => {
          if (!id) form.reset();
        },
      },
    );
  }
  const departmentSelect = (value?: number) => (
    <select name="departmentId" defaultValue={value || ''} required>
      <option value="">Select a department</option>
      {departments
        .filter((dep) => dep.active)
        .map((dep) => (
          <option key={dep.id} value={dep.id}>
            {dep.name}
          </option>
        ))}
    </select>
  );
  return (
    <>
      <FormError error={query.error || mutation.error} />
      {success && <Success>{success}</Success>}
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Issue categories & routing</h2>
            <p className="muted small">
              Set the team suggested for each category. Emergency and confidentiality rules stay
              attached when renamed.
            </p>
          </div>
        </div>
        <form className="add-row" onSubmit={(e) => submit(e)}>
          <Field label="New issue category" required>
            <input name="name" placeholder="Category name" minLength={2} maxLength={160} required />
          </Field>
          <Field label="Default department" required>
            {departmentSelect()}
          </Field>
          <button className="button primary" disabled={mutation.isPending}>
            <Icon name="plus" size={17} />
            Add category
          </button>
        </form>
        {query.isLoading ? (
          <Loading />
        ) : (
          <div className="admin-rows">
            {query.data?.items.map((category) => (
              <div className="admin-row" key={category.id}>
                {edit === category.id ? (
                  <form className="edit-routing-form" onSubmit={(e) => submit(e, category.id)}>
                    <Field label="Category name" required>
                      <input
                        name="name"
                        defaultValue={category.name}
                        minLength={2}
                        maxLength={160}
                        required
                      />
                    </Field>
                    <Field label="Default department" required>
                      {departmentSelect(category.departmentId)}
                    </Field>
                    <Field label="Status">
                      <select name="active" defaultValue={String(category.active)}>
                        <option value="true">Active</option>
                        <option value="false">Inactive</option>
                      </select>
                    </Field>
                    <button className="button primary" disabled={mutation.isPending}>
                      Save
                    </button>
                    <button className="button quiet" type="button" onClick={() => setEdit(null)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <div>
                      <strong>{category.name}</strong>
                      <span className="muted small block">
                        Routes to{' '}
                        {category.departmentName ||
                          departments.find((d) => d.id === category.departmentId)?.name}
                      </span>
                    </div>
                    <div className="category-flags">
                      {category.emergency && (
                        <span className="priority priority-critical">Critical routing</span>
                      )}
                      {category.confidential && (
                        <span className="confidential-label">
                          <Icon name="shield" size={14} />
                          Confidential
                        </span>
                      )}
                      {!category.active && <span className="muted small">Inactive</span>}
                      <button
                        className="button secondary small-button"
                        onClick={() => {
                          setEdit(category.id);
                          setSuccess('');
                          mutation.reset();
                        }}
                      >
                        Edit
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
function SettingsPanel() {
  const query = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => request<Settings>('/admin/settings'),
  });
  const [draft, setDraft] = useState<Settings | null>(null);
  const [success, setSuccess] = useState('');
  const client = useQueryClient();
  useEffect(() => {
    if (query.data && !draft) setDraft(query.data);
  }, [query.data]);
  const mutation = useMutation({
    mutationFn: (data: Settings) =>
      request<Settings>('/admin/settings', { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: (data) => {
      setDraft(data);
      setSuccess(
        'Service settings saved. Existing resolution cycles keep their original SLA snapshots.',
      );
      client.setQueryData(['admin', 'settings'], data);
    },
  });
  return (
    <>
      <FormError error={query.error || mutation.error} />
      {success && <Success>{success}</Success>}
      {query.isLoading ? (
        <Loading />
      ) : (
        draft && (
          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              setSuccess('');
              mutation.mutate(draft);
            }}
          >
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Service level targets</h2>
                  <p className="muted small">
                    Resolution time in hours, measured from submission or the start of a reopened
                    cycle.
                  </p>
                </div>
              </div>
              <div className="sla-settings">
                {PRIORITIES.map((priority) => (
                  <Field key={priority} label={`${priority} priority`} required hint="Hours">
                    <input
                      type="number"
                      min={1}
                      max={8760}
                      step={1}
                      required
                      value={draft.sla[priority]}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          sla: { ...draft.sla, [priority]: Number(e.target.value) },
                        })
                      }
                    />
                  </Field>
                ))}
              </div>
            </section>
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Email templates</h2>
                  <p className="muted small">
                    Keep the existing placeholder names to include the report reference and details.
                  </p>
                </div>
              </div>
              <div className="template-list">
                {draft.emailTemplates.map((template, index) => (
                  <div className="email-template" key={template.event}>
                    <h3>{template.event.replaceAll('_', ' ')}</h3>
                    <Field label="Subject" required>
                      <input
                        maxLength={200}
                        value={template.subject}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            emailTemplates: draft.emailTemplates.map((item, i) =>
                              i === index ? { ...item, subject: e.target.value } : item,
                            ),
                          })
                        }
                        required
                      />
                    </Field>
                    <Field label="Email body" required>
                      <textarea
                        rows={4}
                        maxLength={10000}
                        value={template.body}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            emailTemplates: draft.emailTemplates.map((item, i) =>
                              i === index ? { ...item, body: e.target.value } : item,
                            ),
                          })
                        }
                        required
                      />
                    </Field>
                  </div>
                ))}
              </div>
            </section>
            <div className="form-actions settings-actions">
              <button
                type="button"
                className="button secondary"
                disabled={mutation.isPending}
                onClick={() => {
                  if (query.data) setDraft(query.data);
                  setSuccess('');
                }}
              >
                Discard changes
              </button>
              <button className="button primary" type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Saving…' : 'Save settings'}
                <Icon name="check" size={17} />
              </button>
            </div>
          </form>
        )
      )}
    </>
  );
}
