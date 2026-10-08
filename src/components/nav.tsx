'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './icons';

export interface NavLinkItem { key: string; label: string; href: string; icon: string }

const isActive = (path: string, href: string) => (href === '/dashboard' ? path === href : path === href || path.startsWith(href + '/'));

/** Only the most specific matching link is highlighted, so /tasks/board does not also light up /tasks. */
const bestMatch = (path: string, hrefs: string[]) => hrefs.filter((h) => isActive(path, h)).sort((a, b) => b.length - a.length)[0];

export function SideNav({ groups, onNavigate }: { groups: [string, NavLinkItem[]][]; onNavigate?: () => void }) {
  const path = usePathname() ?? '';
  const best = bestMatch(path, groups.flatMap(([, it]) => it.map((i) => i.href)));
  return (
    <nav aria-label="Main" className="space-y-5">
      {groups.map(([g, items]) => (
        <div key={g}>
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-white/45">{g}</p>
          <ul className="space-y-0.5">
            {items.map((i) => {
              const on = i.href === best;
              return (
                <li key={i.key}>
                  <Link href={i.href} onClick={onNavigate} aria-current={on ? 'page' : undefined}
                    className={`group flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${on ? 'bg-white/15 text-white shadow-inner' : 'text-white/80 hover:bg-white/10 hover:text-white'}`}>
                    <span className={on ? 'text-accent' : 'text-white/60 group-hover:text-white'}><Icon name={i.icon} /></span>
                    <span className="truncate">{i.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Thumb-friendly bottom bar for phones: the four most useful destinations plus the full menu. */
export function BottomNav({ items }: { items: NavLinkItem[] }) {
  const path = usePathname() ?? '';
  return (
    <nav aria-label="Quick navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel/95 backdrop-blur lg:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <ul className="mx-auto flex max-w-xl items-stretch justify-around">
        {items.map((i) => {
          const on = isActive(path, i.href);
          return (
            <li key={i.key} className="flex-1">
              <Link href={i.href} aria-current={on ? 'page' : undefined} className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${on ? 'text-brand' : 'text-muted'}`}>
                <span className={on ? 'rounded-full bg-accent/25 px-3 py-0.5 text-brand' : 'px-3 py-0.5'}><Icon name={i.icon} className="h-5 w-5" /></span>
                <span className="max-w-[4.5rem] truncate">{i.label}</span>
              </Link>
            </li>
          );
        })}
        <li className="flex-1">
          <button type="button" onClick={() => window.dispatchEvent(new Event('ws-open-menu'))} className="flex min-h-[56px] w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted">
            <span className="px-3 py-0.5"><Icon name="menu" /></span><span>More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
