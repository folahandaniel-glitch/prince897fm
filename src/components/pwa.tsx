'use client';
import { useEffect, useState } from 'react';

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const KEY = 'ws-install-dismissed';
const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

const safe = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage may be blocked */ } },
};

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
}
function isIos() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

/** Registers the service worker, offers installation honestly per platform, and shows connection status. */
export function PwaBoot() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) setUpdateReady(true); });
        });
      }).catch(() => { /* PWA features are an enhancement */ });
    }
    const dismissedAt = Number(safe.get(KEY) ?? 0);
    const cooling = Date.now() - dismissedAt < COOLDOWN_MS;
    const installed = isStandalone();
    const onBip = (e: Event) => { e.preventDefault(); setDeferred(e as BIPEvent); if (!cooling && !installed) setOpen(true); };
    const onManual = () => setOpen(true);
    const onInstalled = () => { setDeferred(null); setOpen(false); };
    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('ws-open-install', onManual);
    window.addEventListener('appinstalled', onInstalled);
    if (isIos() && !installed) { setShowIos(true); if (!cooling) setOpen(true); }
    setOnline(navigator.onLine);
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip); window.removeEventListener('ws-open-install', onManual);
      window.removeEventListener('appinstalled', onInstalled); window.removeEventListener('online', on); window.removeEventListener('offline', off);
    };
  }, []);

  const dismiss = () => { safe.set(KEY, String(Date.now())); setOpen(false); };
  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null); setOpen(false);
  };

  return (
    <>
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center">
        {!online && <p className="pointer-events-auto m-2 rounded-full bg-amber-700 px-4 py-1 text-sm font-medium text-white shadow">You are offline. Drafts are kept on this device; attendance and approvals need a connection.</p>}
        {updateReady && online && (
          <p className="pointer-events-auto m-2 flex items-center gap-3 rounded-full bg-brand px-4 py-1 text-sm text-white shadow">
            A new version is available. <button className="underline" onClick={() => location.reload()}>Update now</button>
          </p>
        )}
      </div>
      {open && !isStandalone() && (deferred || showIos) && (
        <section role="dialog" aria-label="Install app" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-2xl border border-line bg-panel p-4 shadow-xl">
          <h2 className="text-base font-semibold">Install WorkSuite</h2>
          {deferred ? (
            <p className="mt-1 text-sm text-muted">Get faster access by installing WorkSuite on this device.</p>
          ) : (
            <p className="mt-1 text-sm text-muted">To install on this device, tap <strong>Share</strong> in Safari, then <strong>Add to Home Screen</strong>.</p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button className="btn-ghost" onClick={dismiss}>Not now</button>
            {deferred && <button className="btn-primary" onClick={install}>Install App</button>}
            {!deferred && <button className="btn-primary" onClick={dismiss}>Got it</button>}
          </div>
        </section>
      )}
    </>
  );
}

/** Menu entry that is available again after the banner was dismissed. Renders nothing where installation is unsupported. */
export function InstallMenuItem() {
  const [can, setCan] = useState(false);
  useEffect(() => {
    if (isStandalone()) return;
    const on = () => setCan(true);
    window.addEventListener('beforeinstallprompt', on);
    if (isIos()) setCan(true);
    return () => window.removeEventListener('beforeinstallprompt', on);
  }, []);
  if (!can) return null;
  return <button className="btn-ghost w-full justify-start" onClick={() => window.dispatchEvent(new Event('ws-open-install'))}>Install WorkSuite</button>;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system');
  useEffect(() => { const t = safe.get('ws-theme'); if (t === 'light' || t === 'dark') setTheme(t); }, []);
  const apply = (t: 'system' | 'light' | 'dark') => {
    setTheme(t);
    if (t === 'system') { try { localStorage.removeItem('ws-theme'); } catch { /* ignore */ } document.documentElement.removeAttribute('data-theme'); }
    else { safe.set('ws-theme', t); document.documentElement.setAttribute('data-theme', t); }
  };
  return (
    <label className="block text-sm">
      <span className="label">Theme</span>
      <select className="input" value={theme} onChange={(e) => apply(e.target.value as any)}>
        <option value="system">System default</option><option value="light">Light</option><option value="dark">Dark</option>
      </select>
    </label>
  );
}
