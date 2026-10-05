import type { ReactElement } from 'react';

const P: Record<string, ReactElement> = {
  home: <path d="M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  doc: <><path d="M7 3.5h7l4 4V20.5H7z" /><path d="M14 3.5v4h4M9.5 12h6M9.5 15.5h6" /></>,
  check: <><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.3 2.4 2.4 4.6-5" /></>,
  people: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19.5c.5-3.2 2.8-5 5.5-5s5 1.8 5.5 5M16 6.2a3 3 0 0 1 0 5.6M17.5 14.8c1.8.5 3 2.1 3.3 4.4" /></>,
  inbox: <path d="M3.5 13.5 6 5.5h12l2.5 8M3.5 13.5V19h17v-5.5h-5l-1 2h-5l-1-2z" />,
  chart: <path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6" />,
  coins: <><ellipse cx="12" cy="7" rx="7" ry="3" /><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" /></>,
  wallet: <><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" /><rect x="4" y="8" width="16" height="11" rx="2" /><path d="M16 13.5h.01" /></>,
  shield: <path d="M12 3.5 5 6v6c0 4 3 7 7 8.5 4-1.5 7-4.5 7-8.5V6z" />,
  scale: <path d="M12 4v16M6 20h12M5 8h14M7 8l-3 6a3 3 0 0 0 6 0zM17 8l-3 6a3 3 0 0 0 6 0z" />,
  briefcase: <><rect x="3.5" y="7.5" width="17" height="12" rx="2" /><path d="M9 7.5V5.5h6v2M3.5 12.5h17" /></>,
  headset: <path d="M4.5 13v-1a7.5 7.5 0 0 1 15 0v1M4.5 13h2.5v5h-2.5zM17 13h2.5v5H17zM17 18.5c0 1.2-1.5 2-4 2" />,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4 7 8 6 8-6" /></>,
  folder: <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4.5l2 2.5H19A1.5 1.5 0 0 1 20.5 10v8A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18z" />,
  grid: <path d="M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6" /></>,
  pin: <><path d="M12 21s6.5-5.5 6.5-11a6.5 6.5 0 0 0-13 0c0 5.5 6.5 11 6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>,
  tree: <path d="M12 4v5M12 9H6v4M12 9h6v4M6 13v3.5M18 13v3.5M3.5 16.5h5M15.5 16.5h5" />,
  palette: <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-1 1.6-2.1-.5-1.4.3-2.4 1.7-2.4H17a3.5 3.5 0 0 0 3.5-3.5C20.5 7.1 16.7 3.5 12 3.5zM8 11.5h.01M10.5 7.5h.01M15 8h.01" />,
  plus: <path d="M12 5v14M5 12h14" />,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  bell: <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14zM10 20.5h4" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  user: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c.7-3.6 3.6-5.5 7-5.5s6.3 1.9 7 5.5" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>,
  tv: <><rect x="3.5" y="5" width="17" height="11.5" rx="2" /><path d="M9 20h6M12 16.5V20" /></>,
  dot: <circle cx="12" cy="12" r="2.5" />,
};

export function Icon({ name, className = 'h-5 w-5' }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" focusable="false">
      {P[name] ?? P.dot}
    </svg>
  );
}
