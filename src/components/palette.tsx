'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Item { kind: string; title: string; subtitle?: string; href: string }

/** Ctrl/Cmd+K command palette: jump to a page (only those you may open) or search records you are allowed to see. */
export function CommandPalette({ links }: { links: { label: string; href: string }[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Item[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === 'Escape') setOpen(false);
    };
    const manual = () => setOpen(true);
    window.addEventListener('keydown', key); window.addEventListener('ws-open-search', manual);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('ws-open-search', manual); };
  }, []);

  useEffect(() => { if (open) { setQ(''); setHits([]); setActive(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctl.signal }).then((r) => (r.ok ? r.json() : { hits: [] })).then((d) => setHits(d.hits ?? [])).catch(() => {});
    }, 180);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);

  const pages: Item[] = links.filter((l) => !q || l.label.toLowerCase().includes(q.toLowerCase())).map((l) => ({ kind: 'Go to', title: l.label, href: l.href }));
  const items = [...pages.slice(0, 6), ...hits];
  const go = (i: Item) => { setOpen(false); router.push(i.href); };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div role="dialog" aria-modal="true" aria-label="Search and commands" className="w-full max-w-lg overflow-hidden rounded-xl border border-line bg-panel shadow-2xl">
        <input
          ref={input} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} placeholder="Search people, tasks, or jump to a page…" aria-label="Search"
          className="w-full border-b border-line bg-transparent px-4 py-3 text-base outline-none"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            if (e.key === 'Enter' && items[active]) go(items[active]);
          }}
        />
        <ul className="max-h-80 overflow-y-auto py-1" role="listbox">
          {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">{q.trim().length < 2 ? 'Type to search.' : 'No matches you have access to.'}</li>}
          {items.map((it, i) => (
            <li key={`${it.href}-${i}`} role="option" aria-selected={i === active}>
              <button type="button" onMouseEnter={() => setActive(i)} onClick={() => go(it)} className={`flex min-h-[44px] w-full items-center justify-between gap-3 px-4 text-left text-sm ${i === active ? 'bg-surface' : ''}`}>
                <span><span className="font-medium">{it.title}</span>{it.subtitle && <span className="ml-2 text-muted">{it.subtitle}</span>}</span><span className="badge">{it.kind}</span></button></li>))}
        </ul>
        <p className="border-t border-line px-4 py-2 text-xs text-muted">↑ ↓ to move · Enter to open · Esc to close · Ctrl/Cmd+K to toggle</p>
      </div>
    </div>
  );
}
