import { z } from 'zod';

export const ROLES = [
  'Student',
  'Faculty',
  'Staff',
  'Campus Incharge',
  'Department Officer',
  'Administrator',
] as const;
export const STATUSES = [
  'Submitted',
  'Verified',
  'Assigned',
  'In Progress',
  'Resolved',
  'Returned',
  'Rejected',
] as const;
export const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const;
export type Role = (typeof ROLES)[number];
export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export const REPORTER_ROLES: readonly Role[] = ['Student', 'Faculty', 'Staff'];
export const SLA_HOURS: Record<Priority, number> = { Low: 168, Medium: 72, High: 24, Critical: 24 };
export const MAX_FILES = 5;
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const passwordSchema = z
  .string()
  .min(12)
  .max(128)
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/[0-9]/, 'Include a number')
  .regex(/[^A-Za-z0-9]/, 'Include a symbol');
export const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: passwordSchema,
});
export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((v) => v.toLowerCase()),
  password: z.string().min(1).max(128),
});
export const profileSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  contactNumber: z.string().trim().max(30).optional(),
  affiliation: z.string().trim().max(160).optional(),
});
export const complaintSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
  description: z.string().trim().min(15).max(10000),
  location: z.string().trim().min(2).max(255),
  anonymous: z.preprocess((v) => v === true || v === 'true', z.boolean()).default(false),
});
export const feedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).default(''),
});
export const actionSchema = z.object({
  action: z.enum([
    'verify',
    'return',
    'reject',
    'assign',
    'priority',
    'start',
    'progress',
    'resolve',
    'reopen',
    'escalate',
    'resubmit',
  ]),
  reason: z.string().trim().max(2000).optional(),
  note: z.string().trim().max(5000).optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  priority: z.enum(PRIORITIES).optional(),
  summary: z.string().trim().max(5000).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  description: z.string().trim().max(10000).optional(),
  location: z.string().trim().max(255).optional(),
  version: z.number().int().nonnegative().optional(),
});
export type ComplaintAction = z.infer<typeof actionSchema>;
export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  departmentId: number | null;
  departmentName?: string | null;
  contactNumber: string | null;
  affiliation: string | null;
  photoUrl: string | null;
  active: boolean;
  createdAt: string;
}
export interface Department {
  id: number;
  name: string;
  active: boolean;
}
export interface Category {
  id: number;
  code: string;
  name: string;
  departmentId: number;
  departmentName?: string;
  confidential: boolean;
  emergency: boolean;
  active: boolean;
}
export interface Catalog {
  departments: Department[];
  categories: Category[];
}
export interface Attachment {
  id: number;
  name: string;
  mime: string;
  size: number;
  kind: 'report' | 'proof';
  createdAt: string;
}
export interface HistoryEntry {
  id: number;
  fromStatus: Status | null;
  toStatus: Status;
  actorRole: Role | 'System';
  note: string;
  createdAt: string;
}
export interface ProgressNote {
  id: number;
  note: string;
  actorRole: Role;
  createdAt: string;
}
export interface Complaint {
  id: number;
  reference: string;
  categoryId: number;
  categoryName: string;
  departmentId: number | null;
  departmentName: string | null;
  status: Status;
  priority: Priority;
  description: string;
  location: string;
  anonymous: boolean;
  confidential: boolean;
  emergency: boolean;
  reporter: { id: number; name: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  slaDueAt: string;
  escalatedAt: string | null;
  version: number;
  resolutionSummary: string | null;
  rating: number | null;
}
export interface ComplaintDetail extends Complaint {
  history: HistoryEntry[];
  notes: ProgressNote[];
  attachments: Attachment[];
  assignments: {
    id: number;
    departmentName: string;
    actorRole: string;
    reason: string;
    createdAt: string;
  }[];
  feedback: { rating: number; comment: string; createdAt: string } | null;
}
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface AppNotification {
  id: number;
  title: string;
  body: string;
  complaintId: number | null;
  readAt: string | null;
  createdAt: string;
}
export interface Dashboard {
  total: number;
  open: number;
  overdue: number;
  resolved: number;
  countsByStatus: { status: Status; count: number }[];
  countsByPriority: { priority: Priority; count: number }[];
  averageResolutionHours: number | null;
  medianResolutionHours: number | null;
  departments: {
    id: number;
    name: string;
    count: number;
    averageHours: number | null;
    averageRating: number | null;
    slaCompliance: number | null;
    flagged: boolean;
  }[];
  recent: Complaint[];
}
export interface Report {
  type: 'category' | 'department' | 'status' | 'sla';
  from: string | null;
  to: string | null;
  rows: {
    label: string;
    count: number;
    resolved: number;
    averageHours: number | null;
    slaCompliance: number | null;
  }[];
}
export interface ApiError {
  error: { code: string; message: string; fields?: Record<string, string[]> };
}
export interface AuthResponse {
  user: User;
  accessToken: string;
  csrfToken: string;
}

export const SEED_DEPARTMENTS = [
  'Civil Engineering',
  'Administration',
  'Estate Maintenance',
  'Information Technology',
  'Computer Engineering',
  'Electronics & Telecommunication Engineering',
  'Library and Learning Resource Development',
  'Medical Services',
  'Students Development and Welfare',
  'Anti-Ragging Committee',
  'Security Services',
] as const;
export const SEED_CATEGORIES = [
  ['CLASSROOM', 'Classroom Infrastructure', 'Civil Engineering', false, false],
  ['ELECTRICAL', 'Electrical and Power Issues', 'Estate Maintenance', false, false],
  ['PLUMBING', 'Plumbing and Water Supply', 'Civil Engineering', false, false],
  ['FURNITURE', 'Furniture and Fixture Damage', 'Estate Maintenance', false, false],
  ['CLEANLINESS', 'Cleanliness and Sanitation', 'Administration', false, false],
  ['WASTE', 'Waste Management', 'Administration', false, false],
  ['NETWORK', 'Wi-Fi and Network Issues', 'Information Technology', false, false],
  ['COMPUTER', 'Computer and Software Lab Issues', 'Computer Engineering', false, false],
  [
    'PROJECTOR',
    'Projector and Electronic Equipment Issues',
    'Electronics & Telecommunication Engineering',
    false,
    false,
  ],
  [
    'LIBRARY',
    'Library and Learning Resource Issues',
    'Library and Learning Resource Development',
    false,
    false,
  ],
  ['TRANSPORT', 'Transport and Parking Issues', 'Administration', false, false],
  ['MEDICAL', 'Medical Emergencies', 'Medical Services', false, true],
  ['MENTAL_HEALTH', 'Mental Health Concerns', 'Students Development and Welfare', true, true],
  ['ANTI_RAGGING', 'Anti-Ragging Complaints', 'Anti-Ragging Committee', true, true],
  ['SECURITY', 'Security and Safety Issues', 'Security Services', false, true],
] as const;
