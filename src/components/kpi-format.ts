/** Human text for one KPI measure's result. */
export function fmtValue(l: { source: string; unit: string; value: number | null }) {
  if (l.value == null) return l.source === 'manual' ? 'Not rated yet' : 'No data yet';
  if (l.source === 'sales_target') return `₦${Math.round(l.value).toLocaleString('en-NG')}`;
  if (l.source === 'new_clients') return `${l.value} ${l.unit}`;
  return `${Math.round(l.value * 10) / 10}%`;
}
