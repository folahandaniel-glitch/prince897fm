'use client';
import { useState } from 'react';

/** Coordinates box for Google Maps values, with a live "check on the map" link and a "use my location" helper. */
export function CoordsInput({ name = 'coordinates', defaultValue = '', label = 'Google coordinates' }: { name?: string; defaultValue?: string; label?: string }) {
  const [v, setV] = useState(defaultValue);
  const [note, setNote] = useState('');
  const m = /(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)/.exec(v);
  const useMine = () => {
    if (!navigator.geolocation) { setNote('This device cannot share its location.'); return; }
    setNote('Finding your position…');
    navigator.geolocation.getCurrentPosition(
      (p) => { setV(`${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`); setNote(`Filled from this device (accuracy about ${Math.round(p.coords.accuracy)} m). Stand at the branch for best results.`); },
      () => setNote('Location permission was refused.'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };
  return (
    <div className="mb-3">
      <label className="label" htmlFor={name}>{label}</label>
      <input id={name} name={name} value={v} onChange={(e) => setV(e.target.value)} className="input" placeholder="7.3990014, 3.9411920" inputMode="decimal" autoComplete="off" />
      <p className="mt-1 text-xs text-muted">In Google Maps right-click the place and click the numbers to copy them, then paste here. {m && <a className="underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${m[1]},${m[2]}`}>Check on Google Maps</a>}{' · '}<button type="button" onClick={useMine} className="underline">Use my current location</button></p>
      {note && <p role="status" className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}
