'use client';
import { useState, useTransition } from 'react';

type Result = { ok?: string; error?: string } | null;
type Act = (p: { lat?: number | null; lng?: number | null; accuracyM?: number | null; deviceId: string; key: string; workplaceId?: string }) => Promise<Result>;

function deviceId() {
  try {
    let d = localStorage.getItem('ws-device');
    if (!d) { d = crypto.randomUUID(); localStorage.setItem('ws-device', d); }
    return d;
  } catch { return 'unknown'; }
}

/** Point-in-time location at the moment of the action only (never tracked in the background). Falls back gracefully. */
function locate(): Promise<{ lat: number; lng: number; accuracyM: number } | { error: string }> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve({ error: 'Location is not available on this device.' });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy }),
      (e) => resolve({ error: e.code === 1 ? 'Location permission was denied.' : 'Could not get your location.' }),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
    );
  });
}

export function ClockPanel({ clockedIn, canClockIn, workplaces, onIn, onOut }: {
  clockedIn: boolean; canClockIn: boolean; workplaces: { id: string; name: string }[]; onIn: Act; onOut: Act;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Result>(null);
  const [note, setNote] = useState('');
  const [wp, setWp] = useState('');

  const go = (act: Act, label: string) => start(async () => {
    setMsg(null); setNote(`Getting your location for ${label}…`);
    const loc = await locate();
    setNote('error' in loc ? `${loc.error} Continuing without it. A supervisor may review this entry.` : '');
    const r = await act({ ...('error' in loc ? {} : loc), deviceId: deviceId(), key: crypto.randomUUID(), workplaceId: wp || undefined });
    setMsg(r); setNote('');
  });

  return (
    <div>
      {!clockedIn && workplaces.length > 1 && (
        <div className="mb-3"><label className="label" htmlFor="wp">Workplace</label>
          <select id="wp" className="input" value={wp} onChange={(e) => setWp(e.target.value)}><option value="">Nearest authorised workplace</option>
            {workplaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
      )}
      <button
        type="button" disabled={pending || (!clockedIn && !canClockIn)}
        onClick={() => go(clockedIn ? onOut : onIn, clockedIn ? 'clock-out' : 'clock-in')}
        className={`${clockedIn ? 'btn-ghost border-2 border-red-700 text-red-700' : 'btn-primary'} min-h-[72px] w-full text-xl`}
      >
        {pending ? 'Please wait…' : clockedIn ? 'Clock out' : 'Clock in'}
      </button>
      <p role="status" aria-live="polite" className="mt-3 min-h-6 text-sm">
        {note && <span className="text-muted">{note}</span>}
        {msg?.ok && <span className="text-emerald-700 dark:text-emerald-400">{msg.ok}</span>}
        {msg?.error && <span className="text-red-700 dark:text-red-400">{msg.error}</span>}
      </p>
    </div>
  );
}

/** Fills latitude/longitude inputs from the admin's current position (useful when standing at the workplace). */
export function UseMyLocation({ latId, lngId }: { latId: string; lngId: string }) {
  const [state, setState] = useState('');
  return (
    <div className="mb-3">
      <button type="button" className="btn-ghost" onClick={async () => {
        setState('Locating…');
        const loc = await locate();
        if ('error' in loc) return setState(loc.error);
        (document.getElementById(latId) as HTMLInputElement).value = loc.lat.toFixed(6);
        (document.getElementById(lngId) as HTMLInputElement).value = loc.lng.toFixed(6);
        setState(`Filled from your position (accuracy ±${Math.round(loc.accuracyM)} m).`);
      }}>Use my current location</button>
      <span role="status" className="ml-3 text-sm text-muted">{state}</span>
    </div>
  );
}
