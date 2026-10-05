export default function Loading() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <div className="skeleton h-8 w-56" />
      <div className="grid gap-3 sm:grid-cols-3"><div className="skeleton h-24" /><div className="skeleton h-24" /><div className="skeleton h-24" /></div>
      <div className="skeleton h-56" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
