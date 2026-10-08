import { z } from 'zod';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour such as #12284C');

export const brandingSchema = z.object({
  name: z.string().min(1).max(80),
  shortName: z.string().min(1).max(24),
  tagline: z.string().max(140).default(''),
  primary: hex, secondary: hex, accent: hex,
  logoUrl: z.string().max(500).default(''), // wide wordmark / lockup
  markUrl: z.string().max(500).default(''), // square-ish emblem
  iconBase: z.string().max(200).default(''), // e.g. /icons/prince -> {base}-192.png, -512.png, -maskable-512.png
  footer: z.string().max(200),
});
export type Branding = z.infer<typeof brandingSchema>;

/** Stable key -> label. Data model identifiers never change; only labels do. */
export const terminologySchema = z.record(
  z.string().regex(/^[a-z_]{2,40}$/),
  z.object({ singular: z.string().min(1).max(40), plural: z.string().min(1).max(40) }),
);
export type Terminology = z.infer<typeof terminologySchema>;

export const navItemSchema = z.object({
  key: z.string(), label: z.string().max(40), href: z.string().startsWith('/'),
  icon: z.string().default('dot'), permission: z.string().nullable().default(null),
  group: z.string().default('Main'), hidden: z.boolean().default(false), feature: z.string().optional(),
});
export const navigationSchema = z.object({ items: z.array(navItemSchema).max(60) });
export type NavItem = z.infer<typeof navItemSchema>;
export type Navigation = z.infer<typeof navigationSchema>;

export const DEFAULT_TERMS: Terminology = {
  organization: { singular: 'Organization', plural: 'Organizations' },
  employee: { singular: 'Employee', plural: 'Employees' },
  department: { singular: 'Department', plural: 'Departments' },
  branch: { singular: 'Branch', plural: 'Branches' },
  position: { singular: 'Position', plural: 'Positions' },
  supervisor: { singular: 'Supervisor', plural: 'Supervisors' },
};

export const DEFAULT_BRANDING: Branding = {
  name: 'WorkSuite', shortName: 'WorkSuite', tagline: '',
  primary: '#12284C', secondary: '#0F766E', accent: '#B45309',
  logoUrl: '', markUrl: '', iconBase: '', footer: 'Powered by Fodan Softnet Inc. (+234 806 757 8112)',
};

export const DEFAULT_NAV: Navigation = {
  items: [
    { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: "home", permission: null, group: "Dashboard", hidden: false },
    { key: "tasks", label: "My Tasks", href: "/tasks", icon: "check", permission: "task:create", group: "My Work", hidden: false, feature: "tasks" },
    { key: "deliverables", label: "My Deliverables", href: "/deliverables", icon: "doc", permission: "deliverable:submit", group: "My Work", hidden: false, feature: "kpi" },
    { key: "projects", label: "Projects", href: "/tasks/projects", icon: "folder", permission: "task:create", group: "My Work", hidden: false, feature: "tasks" },
    { key: "reports", label: "Reports", href: "/reports", icon: "doc", permission: "report:submit", group: "My Work", hidden: false, feature: "reports" },
    { key: "kpi", label: "My KPI", href: "/kpi", icon: "chart", permission: "kpi:view:own", group: "My Work", hidden: false, feature: "kpi" },
    { key: "performance", label: "My Performance", href: "/performance", icon: "target", permission: "kpi:view:own", group: "My Work", hidden: false, feature: "kpi" },
    { key: "assessment", label: "Monthly assessment", href: "/assessment", icon: "check", permission: "assessment:take", group: "My Work", hidden: false, feature: "kpi" },
    { key: "attendance", label: "Attendance", href: "/attendance", icon: "clock", permission: "attendance:clock", group: "My Work", hidden: false, feature: "attendance" },
    { key: "my-shifts", label: "My shifts", href: "/roster/mine", icon: "clock", permission: "roster:swap", group: "My Work", hidden: false, feature: "attendance" },
    { key: "excuses", label: "Late Excuses", href: "/attendance/excuses", icon: "inbox", permission: "attendance:clock", group: "My Work", hidden: false, feature: "attendance" },
    { key: "leave", label: "Leave", href: "/leave", icon: "calendar", permission: "leave:request", group: "My Work", hidden: false, feature: "attendance" },
    { key: "payslips", label: "My payslips", href: "/payslips", icon: "wallet", permission: "payslip:view:own", group: "My Work", hidden: false, feature: "payroll" },
    { key: "advances", label: "Salary Advances", href: "/advances", icon: "coins", permission: "advance:request", group: "My Work", hidden: false, feature: "payroll" },
    { key: "my-discipline", label: "Warnings & queries", href: "/discipline", icon: "scale", permission: "discipline:view:own", group: "My Work", hidden: false, feature: "discipline" },
    { key: "training", label: "My training", href: "/training", icon: "target", permission: "training:view:own", group: "My Work", hidden: false, feature: "training" },
    { key: "mail", label: "Mail", href: "/mail", icon: "mail", permission: "mail:use", group: "My Work", hidden: false, feature: "mail" },
    { key: "team-kpi", label: "Team Performance", href: "/kpi/team", icon: "chart", permission: "kpi:view", group: "Team", hidden: false, feature: "kpi" },
    { key: "board", label: "Task Board", href: "/tasks/board", icon: "grid", permission: "task:assign", group: "Team", hidden: false, feature: "tasks" },
    { key: "deliverable-review", label: "Review Deliverables", href: "/deliverables/review", icon: "inbox", permission: "deliverable:review", group: "Team", hidden: false, feature: "kpi" },
    { key: "deliverable-setup", label: "Deliverable Setup", href: "/deliverables/setup", icon: "gear", permission: "deliverable:manage", group: "Team", hidden: false, feature: "kpi" },
    { key: "kpi-profiles", label: "Team KPI", href: "/kpi/profiles", icon: "target", permission: "kpi:manage", group: "Team", hidden: false, feature: "kpi" },
    { key: "flags", label: "Performance Flags", href: "/performance/flags", icon: "shield", permission: "kpi:view", group: "Team", hidden: false, feature: "kpi" },
    { key: "assessment-manage", label: "Knowledge assessments", href: "/assessment/manage", icon: "doc", permission: "assessment:manage", group: "Team", hidden: false, feature: "kpi" },
    { key: "team", label: "Team attendance", href: "/attendance/team", icon: "people", permission: "attendance:view", group: "Team", hidden: false, feature: "attendance" },
    { key: "report-review", label: "Report reviews", href: "/reports/review", icon: "inbox", permission: "report:review", group: "Team", hidden: false, feature: "reports" },
    { key: "announce", label: "Notice Board", href: "/announcements", icon: "bell", permission: null, group: "Company", hidden: false },
    { key: "memos", label: "Memos", href: "/memos", icon: "mail", permission: "notification:view:own", group: "Company", hidden: false },
    { key: "kb", label: "Knowledge Base", href: "/kb", icon: "folder", permission: "kb:view", group: "Company", hidden: false },
    { key: "calendar", label: "Events & Holidays", href: "/calendar", icon: "calendar", permission: "calendar:view", group: "Company", hidden: false, feature: "calendar" },
    { key: "documents", label: "Documents", href: "/documents", icon: "folder", permission: "doc:view", group: "Company", hidden: false, feature: "documents" },
    { key: "employees", label: "Staff HRM", href: "/employees", icon: "people", permission: "employee:view", group: "HR Management", hidden: false },
    { key: "requests", label: "Registrations", href: "/requests", icon: "inbox", permission: "registration:review", group: "HR Management", hidden: false },
    { key: "roster", label: "Roster", href: "/roster", icon: "grid", permission: "roster:manage", group: "HR Management", hidden: false, feature: "attendance" },
    { key: "swaps", label: "Shift cover requests", href: "/roster/swaps", icon: "inbox", permission: "roster:manage", group: "HR Management", hidden: false, feature: "attendance" },
    { key: "modes", label: "Clock-in locations", href: "/attendance/modes", icon: "pin", permission: "attendance:manage", group: "HR Management", hidden: false, feature: "attendance" },
    { key: "leave-review", label: "Leave requests", href: "/leave/review", icon: "inbox", permission: "leave:review", group: "HR Management", hidden: false, feature: "attendance" },
    { key: "holidays", label: "Public holidays", href: "/leave/holidays", icon: "calendar", permission: "leave:manage", group: "HR Management", hidden: false, feature: "attendance" },
    { key: "payroll", label: "Payroll", href: "/payroll", icon: "wallet", permission: "payroll:view", group: "HR Management", hidden: false, feature: "payroll" },
    { key: "advances-manage", label: "Advance requests", href: "/advances", icon: "coins", permission: "advance:approve", group: "HR Management", hidden: false, feature: "payroll" },
    { key: "discipline", label: "Disciplinary", href: "/discipline/cases", icon: "scale", permission: "discipline:raise", group: "HR Management", hidden: false, feature: "discipline" },
    { key: "training-manage", label: "Training admin", href: "/training/manage", icon: "target", permission: "training:manage", group: "HR Management", hidden: false, feature: "training" },
    { key: "crm", label: "Clients & CRM Pipeline", href: "/crm", icon: "briefcase", permission: "crm:view", group: "Clients", hidden: false, feature: "crm" },
    { key: "contracts", label: "Contracts", href: "/contracts", icon: "doc", permission: "contract:view", group: "Clients", hidden: false, feature: "crm" },
    { key: "contract-templates", label: "Contract Templates", href: "/contracts/templates", icon: "folder", permission: "contract:manage", group: "Clients", hidden: false, feature: "crm" },
    { key: "report-hub", label: "Management Reports", href: "/reports/hub", icon: "chart", permission: "report:oversee", group: "Reports", hidden: false },
    { key: "executive", label: "Command centre", href: "/executive", icon: "chart", permission: "dashboard:executive", group: "Reports", hidden: false },
    { key: "report-oversight", label: "Report compliance", href: "/reports/oversight", icon: "chart", permission: "report:oversee", group: "Reports", hidden: false, feature: "reports" },
    { key: "finance", label: "Finance desk", href: "/finance", icon: "coins", permission: "finance:view", group: "Finance", hidden: false, feature: "finance" },
    { key: "finance-quotes", label: "Proposals & Estimates", href: "/finance/quotes", icon: "doc", permission: "quote:view", group: "Finance", hidden: false, feature: "finance" },
    { key: "finance-invoices", label: "Invoices & bills", href: "/finance/invoices", icon: "doc", permission: "finance:view", group: "Finance", hidden: false, feature: "finance" },
    { key: "finance-payments", label: "Payments", href: "/finance/payments", icon: "wallet", permission: "finance:view", group: "Finance", hidden: false, feature: "finance" },
    { key: "finance-new", label: "Expenses & transactions", href: "/finance/new", icon: "plus", permission: "finance:create", group: "Finance", hidden: false, feature: "finance" },
    { key: "finance-ageing", label: "Ageing", href: "/finance/ageing", icon: "chart", permission: "finance:view", group: "Finance", hidden: false, feature: "finance" },
    { key: "finance-orders", label: "Purchase orders", href: "/finance/orders", icon: "folder", permission: "finance:view", group: "Finance", hidden: false, feature: "finance" },
    { key: "finance-bank", label: "Bank reconciliation", href: "/finance/bank", icon: "coins", permission: "finance:reconcile", group: "Finance", hidden: false, feature: "finance" },
    { key: "finance-tax", label: "VAT & WHT", href: "/finance/tax", icon: "scale", permission: "finance:view", group: "Finance", hidden: false, feature: "finance" },
    { key: "finance-centre", label: "Financial centre", href: "/finance/overview", icon: "chart", permission: "finance:oversee", group: "Finance", hidden: false, feature: "finance" },
    { key: "finance-reports", label: "Ledger & reports", href: "/finance/reports", icon: "doc", permission: "finance:view", group: "Finance", hidden: false, feature: "finance" },
    { key: "finance-budgets", label: "Budgets", href: "/finance/budgets", icon: "target", permission: "finance:view", group: "Finance", hidden: false, feature: "finance" },
    { key: "finance-setup", label: "Finance setup", href: "/finance/setup", icon: "gear", permission: "finance:configure", group: "Finance", hidden: false, feature: "finance" },
    { key: "support", label: "Support Tickets", href: "/tickets", icon: "headset", permission: "ticket:create", group: "Support Tickets", hidden: false, feature: "tickets" },
    { key: "tickets-queue", label: "All Tickets", href: "/tickets/queue", icon: "headset", permission: "ticket:handle", group: "Support Tickets", hidden: false, feature: "tickets" },
    { key: "structure", label: "Structure", href: "/admin/structure", icon: "tree", permission: "structure:manage", group: "Administration", hidden: false },
    { key: "oversight", label: "Oversight", href: "/admin/oversight", icon: "shield", permission: "admin:control", group: "Administration", hidden: false },
    { key: "accounts", label: "Accounts", href: "/admin/accounts", icon: "people", permission: "admin:control", group: "Administration", hidden: false },
    { key: "branches", label: "Branches & locations", href: "/admin/branches", icon: "pin", permission: "structure:manage", group: "Administration", hidden: false },
    { key: "attendance-setup", label: "Shifts & workplaces", href: "/admin/attendance", icon: "pin", permission: "attendance:manage", group: "Administration", hidden: false, feature: "attendance" },
    { key: "report-setup", label: "Report templates", href: "/admin/reports", icon: "doc", permission: "report:manage", group: "Administration", hidden: false, feature: "reports" },
    { key: "builder", label: "Builder", href: "/builder", icon: "grid", permission: "builder:manage", group: "Administration", hidden: false, feature: "builders" },
    { key: "wallboards", label: "TV wallboards", href: "/builder/wallboards", icon: "tv", permission: "wallboard:manage", group: "Administration", hidden: false, feature: "builders" },
    { key: "rules", label: "Discipline rules", href: "/discipline/rules", icon: "scale", permission: "discipline:manage", group: "Administration", hidden: false, feature: "discipline" },
    { key: "payroll-settings", label: "Payroll settings", href: "/payroll/settings", icon: "gear", permission: "payroll:configure", group: "Administration", hidden: false, feature: "payroll" },
    { key: "config", label: "Branding & labels", href: "/admin/config", icon: "palette", permission: "config:manage", group: "Administration", hidden: false },
    { key: "audit", label: "Audit trail", href: "/admin/audit", icon: "shield", permission: "audit:view", group: "Administration", hidden: false },
    { key: "backend", label: "BackEnd", href: "/backend", icon: "lock", permission: "backend:access", group: "Administration", hidden: false },
  ],
};

/** Resolve "{employee.plural}" style placeholders in labels. */
export function resolveLabel(label: string, terms: Terminology): string {
  return label.replace(/\{([a-z_]+)\.(singular|plural)\}/g, (_, k: string, f: 'singular' | 'plural') => terms[k]?.[f] ?? DEFAULT_TERMS[k]?.[f] ?? k);
}
export function term(terms: Terminology, key: string, form: 'singular' | 'plural' = 'singular'): string {
  return terms[key]?.[form] ?? DEFAULT_TERMS[key]?.[form] ?? key;
}

/** WCAG relative-luminance contrast ratio, used to guard tenant colours. */
export function contrastRatio(a: string, b: string): number {
  const lum = (h: string) => {
    const [r, g, bl] = [1, 3, 5]
      .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

export function hexToRgbTriplet(h: string): string {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(' ');
}
