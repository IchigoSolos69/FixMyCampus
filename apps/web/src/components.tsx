import {
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type InputHTMLAttributes,
} from 'react';
import { Link } from 'react-router-dom';
import type { Complaint, Priority, Status } from '@fixmycampus/shared';
import { RequestError } from './api';

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    campus: (
      <>
        <path d="m3 8 9-5 9 5-9 5zM6 12v7m6-4v6m6-9v7M3 21h18" />
      </>
    ),
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    complaints: (
      <>
        <path d="M8 4H5v17h14V4h-3M9 3h6v4H9zM8 11h8m-8 4h6" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      </>
    ),
    chart: (
      <>
        <path d="M4 3v18h17M8 17v-5m5 5V7m5 10V4" />
      </>
    ),
    settings: (
      <>
        <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
      </>
    ),
    logout: (
      <>
        <path d="M9 4H4v16h5m7-13 5 5-5 5m-7-5h12" />
      </>
    ),
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    back: <path d="M19 12H5m5-5-5 5 5 5" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    file: (
      <>
        <path d="M14 2H5v20h14V7zM14 2v6h5M8 12h8m-8 4h5" />
      </>
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="7" />
        <path d="m15 15 6 6" />
      </>
    ),
    location: (
      <>
        <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0" />
        <circle cx="12" cy="10" r="2" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
      </>
    ),
    warning: (
      <>
        <path d="m12 3 10 18H2zM12 9v5m0 3v.2" />
      </>
    ),
    menu: <path d="M3 6h18M3 12h18M3 18h18" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.file}
    </svg>
  );
}
export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`badge status-${status.toLowerCase().replaceAll(' ', '-')}`}>
      <span className="status-dot" />
      {status}
    </span>
  );
}
export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`priority priority-${priority.toLowerCase()}`}>
      <span className="priority-bars" aria-hidden="true">
        ▮
      </span>
      {priority}
    </span>
  );
}
export function date(value: string | null, withTime = true) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(value));
}
export function hours(value: number | null | undefined) {
  return value == null ? '—' : `${Number(value).toFixed(1)} h`;
}
export function slaLabel(complaint: Complaint) {
  if (complaint.status === 'Resolved') return 'Resolved';
  if (complaint.status === 'Rejected') return 'Closed';
  const diff = new Date(complaint.slaDueAt).getTime() - Date.now();
  const h = Math.ceil(Math.abs(diff) / 3600000);
  return diff < 0 ? `${h}h overdue` : `${h}h remaining`;
}
export function Field({
  label,
  children,
  hint,
  required = false,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  required?: boolean;
}) {
  const hintId = useId();
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        'aria-label': label,
        ...(hint ? { 'aria-describedby': hintId } : {}),
      })
    : children;
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {required && (
          <span className="required" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </span>
      {control}
      {hint && (
        <span id={hintId} className="field-hint">
          {hint}
        </span>
      )}
    </label>
  );
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} />;
}
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} />;
}
export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="notice error" role="alert">
      <Icon name="warning" />
      <div>
        <strong>{error instanceof Error ? error.message : String(error)}</strong>
        {error instanceof RequestError && error.fields && (
          <ul>
            {Object.entries(error.fields).map(([field, messages]) => (
              <li key={field}>
                {field}: {messages.join(', ')}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
export function Success({ children }: { children: ReactNode }) {
  return (
    <div className="notice success" role="status">
      <Icon name="check" />
      {children}
    </div>
  );
}
export function Loading({ label = 'Loading campus records…' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      {label}
    </div>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name="complaints" size={28} />
      </span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
export function PageHeading({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="heading-actions">{children}</div>}
    </header>
  );
}
export function ComplaintTable({
  items,
  compact = false,
}: {
  items: Complaint[];
  compact?: boolean;
}) {
  if (!items.length)
    return (
      <Empty title="No complaints here">
        Reports matching this view will appear here. Try adjusting the filters.
      </Empty>
    );
  return (
    <div className="table-scroll">
      <table className="complaint-table">
        <thead>
          <tr>
            <th scope="col">Complaint</th>
            <th scope="col">Status</th>
            <th scope="col">Priority</th>
            {!compact && <th scope="col">Department</th>}
            <th scope="col">Service deadline</th>
            <th scope="col">
              <span className="sr-only">Open complaint</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <Link className="complaint-reference" to={`/complaints/${item.id}`}>
                  {item.reference}
                </Link>
                <div className="complaint-category">
                  {item.categoryName}
                  {item.confidential && <Icon name="shield" size={14} />}
                </div>
                <span className="muted small">{item.location}</span>
              </td>
              <td>
                <StatusBadge status={item.status} />
              </td>
              <td>
                <PriorityBadge priority={item.priority} />
              </td>
              {!compact && (
                <td className="department-cell">{item.departmentName || 'Awaiting assignment'}</td>
              )}
              <td>
                <span className={slaLabel(item).includes('overdue') ? 'overdue' : 'sla-time'}>
                  {slaLabel(item)}
                </span>
                <span className="muted small block">{date(item.slaDueAt, false)}</span>
              </td>
              <td>
                <Link
                  className="icon-button"
                  to={`/complaints/${item.id}`}
                  aria-label={`Open ${item.reference}`}
                >
                  <Icon name="arrow" size={18} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function FileInput({
  onChange,
  remaining = 5,
  id,
}: {
  onChange: (files: File[]) => void;
  remaining?: number;
  id?: string;
}) {
  const unique = useId();
  return (
    <label className="file-picker" htmlFor={id || unique}>
      <Icon name="file" size={24} />
      <span>
        <strong>Attach photos or documents</strong>
        <span>JPEG, PNG or PDF · 10 MB per file · up to {remaining} files</span>
      </span>
      <input
        id={id || unique}
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        multiple
        disabled={remaining <= 0}
        onChange={(event) => onChange(Array.from(event.target.files || []))}
      />
    </label>
  );
}
export function validateFiles(files: File[], remaining = 5) {
  if (files.length > remaining)
    return `You can attach ${remaining} more file${remaining === 1 ? '' : 's'}.`;
  if (files.some((f) => f.size > 10 * 1024 * 1024)) return 'Each file must be 10 MB or smaller.';
  if (files.some((f) => !['image/jpeg', 'image/png', 'application/pdf'].includes(f.type)))
    return 'Choose JPEG, PNG or PDF files.';
  return '';
}
