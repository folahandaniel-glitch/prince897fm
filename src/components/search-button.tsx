'use client';
export function SearchButton() {
  return <button type="button" className="btn-ghost" aria-label="Search (Ctrl+K)" onClick={() => window.dispatchEvent(new Event('ws-open-search'))}>Search</button>;
}
