'use client';
import { useCallback, useEffect, useState } from 'react';
import { WidgetGrid } from '@/components/widgets';

type Data = { name: string; org: string; dashboard: string; refresh: number; at: string; tz: string; results: any[] };

/** Full-screen wallboard: large type, high contrast, drifting layout against screen burn-in, recovers by itself after network drops. */
export function Screen({ token, initial }: { token: string; initial: Data }) {
  const [d, setD] = useState<Data>(initial);
  const [ok, setOk] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [drift, setDrift] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/wallboard?t=${encodeURIComponent(token)}`, { cache: 'no-store' });
      if (r.status === 404) { setOk(false); return; }
      if (r.ok) { setD(await r.json()); setOk(true); }
    } catch { setOk(false); }
  }, [token]);

  useEffect(() => { const t = setInterval(load, Math.max(15, d.refresh) * 1000); return () => clearInterval(t); }, [load, d.refresh]);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setInterval(() => setDrift((x) => (x + 1) % 4), 60_000); return () => clearInterval(t); }, []);
  const pad = [0, 6, 12, 6][drift];

  return (
    <main className="min-h-[100dvh] bg-[#050505] p-6 text-white sm:p-10" style={{ paddingTop: 24 + pad, paddingLeft: 24 + pad }}>
      <header className="mb-8 flex items-end justify-between gap-6">
        <div><p className="text-xl font-semibold uppercase tracking-widest text-[#FFC700]">{d.org}</p><h1 className="text-5xl font-bold">{d.dashboard}</h1></div>
        <div className="text-right"><p className="text-6xl font-bold tabular-nums">{now.toLocaleTimeString('en-GB', { timeZone: d.tz, hour: '2-digit', minute: '2-digit' })}</p><p className="text-xl opacity-70">{now.toLocaleDateString('en-GB', { timeZone: d.tz, weekday: 'long', day: 'numeric', month: 'long' })}</p></div>
      </header>
      {d.results.length === 0 ? <p className="text-3xl opacity-70">Nothing to show on this screen.</p> : <WidgetGrid results={d.results} big />}
      <footer className="mt-10 flex justify-between text-lg opacity-60"><span>{d.name}</span><span role="status">{ok ? `Updated ${new Date(d.at).toLocaleTimeString('en-GB', { timeZone: d.tz, hour: '2-digit', minute: '2-digit' })}` : 'Reconnecting…'}</span></footer>
    </main>
  );
}
