'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { SideNav, type NavLinkItem } from './nav';
import { Icon } from './icons';

/** Slide-over navigation for phones and tablets (opened from the header or the bottom bar's "More"). */
export function MenuDrawer({ groups, brand }: { groups: [string, NavLinkItem[]][]; brand: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // However the person moves to another page (a link, the back button, a notification), the menu closes and the page can scroll again.
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    const o = () => setOpen(true);
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('ws-open-menu', o); window.addEventListener('keydown', k);
    return () => { window.removeEventListener('ws-open-menu', o); window.removeEventListener('keydown', k); };
  }, []);
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    const widen = () => { if (window.innerWidth >= 1024) setOpen(false); }; // a rotated tablet or resized window must never keep the page locked
    window.addEventListener('resize', widen);
    return () => { document.body.style.overflow = ''; window.removeEventListener('resize', widen); };
  }, [open]);
  return (
    <>
      <button type="button" className="btn-ghost lg:hidden" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}><Icon name="menu" /></button>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[85%] max-w-sm flex-col overflow-y-auto bg-[#0b0b0b] p-4 shadow-2xl" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
            <div className="mb-4 flex items-center justify-between">{brand}<button type="button" className="rounded-lg p-2 text-white/80 hover:bg-white/10" aria-label="Close menu" onClick={() => setOpen(false)}>✕</button></div>
            <SideNav groups={groups} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
