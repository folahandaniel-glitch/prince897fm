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
    { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: "home", permission: null, group: "Main", hidden: false },
    { key: "attendance", label: "Attendance", href: "/attendance", icon: "clock", permission: "attendance:clock", group: "My work", hidden: false, feature: "attendance" },
    { key: "leave", label: "Leave", href: "/leave", icon: "calendar", permission: "leave:request", group: "My work", hidden: false, feature: "attendance" },
    { key: "my-shifts", label: "My shifts", href: "/roster/mine", icon: "clock", permission: "roster:swap", group: "My work", hidden: false, feature: "attendance" },
    { key: "reports", label: "Reports", href: "/reports", icon: "doc", permission: "report:submit", group: "My work", hidden: false, feature: "reports" },
    { key: "tasks", label: "Tasks", href: "/tasks", icon: "check", permission: "task:create", group: "My work", hidden: false, feature: "tasks" },
    { key: "payslips", label: "My payslips", href: "/payslips", icon: "wallet", permission: "payslip:view:own", group: "My work", hidden: false, feature: "payroll" },
    { key: "kpi", label: "My KPI", href: "/kpi", icon: "chart", permission: "kpi:view:own", group: "My work", hidden: false, feature: "kpi" },
    { key: "assessment", label: "Monthly assessment", href: "/assessment", icon: "check", permission: "assessment:take", group: "My work", hidden: false, feature: "kpi" },
    { key: "my-discipline", label: "Warnings & queries", href: "/discipline", icon: "scale", permission: "discipline:view:own", group: "My work", hidden: false, feature: "discipline" },
    { key: "training", label: "My training", href: "/training", icon: "target", permission: "training:view:own", group: "My work", hidden: false, feature: "training" },
    { key: "mail", label: "Mail", href: "/mail", icon: "mail", permission: "mail:use", group: "My work", hidden: false, feature: "mail" },
    { key: "calendar", label: "Calendar", href: "/calendar", icon: "calendar", permission: "calendar:view", group: "My work", hidden: false, feature: "calendar" },
    { key: "documents", label: "Documents", href: "/documents", icon: "folder", permission: "doc:view", group: "My work", hidden: false, feature: "documents" },
    { key: "support", label: "Support", href: "/tickets", icon: "headset", permission: "ticket:create", group: "My work", hidden: false, feature: "tickets" },
    { key: "employees", label: "{employee.plural}", href: "/employees", icon: "people", permission: "employee:view", group: "People", hidden: false },
    { key: "requests", label: "Registrations", href: "/requests", icon: "inbox", permission: "registration:review", group: "People", hidden: false },
    { key: "executive", label: "Command centre", href: "/executive", icon: "chart", permission: "dashboard:executive", group: "Operations", hidden: false },
    { key: "team", label: "Team attendance", href: "/attendance/team", icon: "people", permission: "attendance:view", group: "Operations", hidden: false, feature: "attendance" },
    { key: "roster", label: "Roster", href: "/roster", icon: "grid", permission: "roster:manage", group: "Operations", hidden: false, feature: "attendance" },
    { key: "swaps", label: "Shift cover requests", href: "/roster/swaps", icon: "inbox", permission: "roster:manage", group: "Operations", hidden: false, feature: "attendance" },
    { key: "kpi-team", label: "Team KPIs", href: "/kpi/team", icon: "chart", permission: "kpi:view", group: "Operations", hidden: false, feature: "kpi" },
    { key: "assessment-manage", label: "Knowledge assessments", href: "/assessment/manage", icon: "doc", permission: "assessment:manage", group: "Operations", hidden: false, feature: "kpi" },
    { key: "modes", label: "Clock-in locations", href: "/attendance/modes", icon: "pin", permission: "attendance:manage", group: "Operations", hidden: false, feature: "attendance" },
    { key: "leave-review", label: "Leave requests", href: "/leave/review", icon: "inbox", permission: "leave:review", group: "Operations", hidden: false, feature: "attendance" },
    { key: "holidays", label: "Public holidays", href: "/leave/holidays", icon: "calendar", permission: "leave:manage", group: "Operations", hidden: false, feature: "attendance" },
    { key: "training-manage", label: "Training admin", href: "/training/manage", icon: "target", permission: "training:manage", group: "Operations", hidden: false, feature: "training" },
    { key: "report-review", label: "Report reviews", href: "/reports/review", icon: "inbox", permission: "report:review", group: "Operations", hidden: false, feature: "reports" },
    { key: "report-oversight", label: "Report compliance", href: "/reports/oversight", icon: "chart", permission: "report:oversee", group: "Operations", hidden: false, feature: "reports" },
    { key: "discipline", label: "Discipline cases", href: "/discipline/cases", icon: "scale", permission: "discipline:raise", group: "Operations", hidden: false, feature: "discipline" },
    { key: "crm", label: "CRM", href: "/crm", icon: "briefcase", permission: "crm:view", group: "Operations", hidden: false, feature: "crm" },
    { key: "tickets-queue", label: "Ticket queue", href: "/tickets/queue", icon: "headset", permission: "ticket:handle", group: "Operations", hidden: false, feature: "tickets" },
    { key: "finance", label: "Finance desk", href: "/finance", icon: "coins", permission: "finance:view", group: "Finance", hidden: false, feature: "finance" },
    { key: "finance-new", label: "New transaction", href: "/finance/new", icon: "plus", permission: "finance:create", group: "Finance", hidden: false, feature: "finance" },
    { key: "finance-invoices", label: "Invoices & bills", href: "/finance/invoices", icon: "doc", permission: "finance:view", group: "Finance", hidden: false, feature: "finance" },
    { key: "finance-ageing", label: "Ageing", href: "/finance/ageing", icon: "chart", permission: "finance:view", group: "Finance", hidden: false, feature: "finance" },
    { key: "finance-orders", label: "Purchase orders", href: "/finance/orders", icon: "folder", permission: "finance:view", group: "Finance", hidden: false, feature: "finance" },
    { key: "finance-bank", label: "Bank reconciliation", href: "/finance/bank", icon: "coins", permission: "finance:reconcile", group: "Finance", hidden: false, feature: "finance" },
    { key: "finance-tax", label: "VAT & WHT", href: "/finance/tax", icon: "scale", permission: "finance:view", group: "Finance", hidden: false, feature: "finance" },
    { key: "finance-centre", label: "Financial centre", href: "/finance/overview", icon: "chart", permission: "finance:oversee", group: "Finance", hidden: false, feature: "finance" },
    { key: "finance-reports", label: "Ledger & reports", href: "/finance/reports", icon: "doc", permission: "finance:view", group: "Finance", hidden: false, feature: "finance" },
    { key: "finance-budgets", label: "Budgets", href: "/finance/budgets", icon: "target", permission: "finance:view", group: "Finance", hidden: false, feature: "finance" },
    { key: "payroll", label: "Payroll", href: "/payroll", icon: "wallet", permission: "payroll:view", group: "Finance", hidden: false, feature: "payroll" },
    { key: "finance-setup", label: "Finance setup", href: "/finance/setup", icon: "gear", permission: "finance:configure", group: "Finance", hidden: false, feature: "finance" },
    { key: "announce", label: "Announcements", href: "/announcements", icon: "bell", permission: "announcement:post", group: "Administration", hidden: false },
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
