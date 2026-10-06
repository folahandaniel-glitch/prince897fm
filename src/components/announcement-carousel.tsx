'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export interface Notice { id: string; title: string; body: string; pinned: boolean; when: string }

/**
 * Rotating announcement banner shown on every page. Auto-advances every 7 seconds, pauses on hover/focus or when asked,
 * works with arrows, dots and swipe, and does not auto-advance for people who prefer reduced motion.
 */
export function AnnouncementCarousel({ items, canPost, brandLogo }: { items: Notice[]; canPost: boolean; brandLogo?: string }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const hover = useRef(false);
  const touch = useRef<number | null>(null);
  const n = items.length;
  const go = useCallback((d: number) => setI((x) => (x + d + n) % n), [n]);

  useEffect(() => { setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches); }, []);
  useEffect(() => {
    if (n < 2 || paused || reduced) return;
    const t = setInterval(() => { if (!hover.current && !document.hidden) go(1); }, 7000);
    return () => clearInterval(t);
  }, [n, paused, reduced, go]);

  if (n === 0) {
    if (!canPost) return null;
    return <div className="no-print mx-auto w-full max-w-6xl px-3 pt-3 sm:px-6"><Link href="/announcements" className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-line px-4 py-2.5 text-sm text-muted hover:bg-surface"><span>📣 No announcements right now.</span><span className="font-medium underline">Post one</span></Link></div>;
  }
  const cur = items[Math.min(i, n - 1)];
  return (
    <section aria-roledescription="carousel" aria-label="Announcements" className="no-print mx-auto w-full max-w-6xl px-3 pt-3 sm:px-6"
      onMouseEnter={() => { hover.current = true; }} onMouseLeave={() => { hover.current = false; }}
      onTouchStart={(e) => { touch.current = e.touches[0].clientX; }} onTouchEnd={(e) => { if (touch.current != null) { const dx = e.changedTouches[0].clientX - touch.current; if (Math.abs(dx) > 45) go(dx < 0 ? 1 : -1); touch.current = null; } }}>
      <div className="relative overflow-hidden rounded-2xl text-white shadow-sm" style={{ background: 'linear-gradient(120deg, rgb(var(--brand)) 0%, rgb(var(--brand) / 0.85) 55%, rgb(var(--brand-2)) 150%)' }}>
        <div aria-hidden className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-[rgb(var(--accent)/0.35)] blur-md" />
        <div className="relative flex items-stretch gap-3 px-3 py-3 sm:px-5 sm:py-4">
          <div className="hidden shrink-0 place-items-center sm:grid">{brandLogo
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={brandLogo} alt="" width={44} height={32} className="h-9 w-auto rounded" /> : <span className="text-2xl" aria-hidden>📣</span>}</div>
          <div className="min-w-0 flex-1" aria-live={paused || reduced ? 'polite' : 'off'} aria-atomic="true">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-white/75">Announcement {n > 1 && <span>{Math.min(i, n - 1) + 1} / {n}</span>}{cur.pinned && <span className="rounded-full bg-white/20 px-2 py-0.5 normal-case tracking-normal">Pinned</span>}</p>
            <p className="mt-0.5 truncate text-base font-bold sm:text-lg">{cur.title}</p>
            <p className="line-clamp-2 text-sm text-white/85">{cur.body}</p>
          </div>
          {n > 1 && <div className="flex shrink-0 flex-col items-center justify-between gap-1">
            <div className="flex gap-1">
              <button type="button" onClick={() => go(-1)} aria-label="Previous announcement" className="grid h-8 w-8 place-items-center rounded-lg bg-white/15 hover:bg-white/25">‹</button>
              <button type="button" onClick={() => setPaused((p) => !p)} aria-pressed={paused} aria-label={paused ? 'Resume rotation' : 'Pause rotation'} className="grid h-8 w-8 place-items-center rounded-lg bg-white/15 text-xs hover:bg-white/25">{paused ? '▶' : '❚❚'}</button>
              <button type="button" onClick={() => go(1)} aria-label="Next announcement" className="grid h-8 w-8 place-items-center rounded-lg bg-white/15 hover:bg-white/25">›</button>
            </div>
            <div className="flex gap-1.5" role="tablist" aria-label="Choose announcement">{items.map((x, k) => <button key={x.id} type="button" role="tab" aria-selected={k === i} aria-label={`Announcement ${k + 1}`} onClick={() => setI(k)} className={`h-2 rounded-full transition-all ${k === i ? 'w-5 bg-[rgb(var(--accent))]' : 'w-2 bg-white/40'}`} />)}</div>
          </div>}
        </div>
      </div>
    </section>
  );
}
