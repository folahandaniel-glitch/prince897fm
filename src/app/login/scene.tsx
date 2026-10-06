/**
 * Decorative 3D radio studio for the sign-in screen: a one-point-perspective on-air studio with acoustic walls, the station sign,
 * a glass window to the control room, a broadcast desk with a mixing console and two boom microphones, live level meters and a moving
 * wavelength display. Pure SVG + CSS (no scripts, no libraries), so it stays light and works under a strict CSP.
 */
const WAVE = (() => { let d = 'M0 30 C 20 5, 40 55, 60 30'; for (let k = 1; k <= 8; k++) d += ` S ${k * 60 + 40} ${k % 2 ? 5 : 55}, ${(k + 1) * 60} 30`; return d; })();

// Point on a side wall: t = depth (0 front .. 1 back), v = height fraction (0 floor .. 1 ceiling).
const wall = (side: 'l' | 'r', t: number, v: number): [number, number] => {
  const x = side === 'l' ? 180 * t : 640 - 180 * t;
  const top = 60 * t, bot = 400 - 175 * t;
  return [Math.round(x * 10) / 10, Math.round((bot - v * (bot - top)) * 10) / 10];
};
const poly = (pts: [number, number][]) => pts.map((p) => p.join(',')).join(' ');
const PANELS: [number, number][] = [[0.07, 0.25], [0.3, 0.48], [0.53, 0.71], [0.76, 0.93]];

export function Studio() {
  return (
    <svg viewBox="0 0 640 400" className="studio3d" role="img" aria-label="PRINCE 89.7 FM on-air radio studio">
      <defs>
        <linearGradient id="st-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1b1b21" /><stop offset="1" stopColor="#0d0d11" /></linearGradient>
        <linearGradient id="st-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#15151a" /><stop offset="1" stopColor="#050507" /></linearGradient>
        <linearGradient id="st-ceil" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#202026" /><stop offset="1" stopColor="#09090b" /></linearGradient>
        <linearGradient id="st-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2a4a63" /><stop offset="1" stopColor="#0e1a24" /></linearGradient>
        <linearGradient id="st-desk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3b2a22" /><stop offset="1" stopColor="#1a120e" /></linearGradient>
        <linearGradient id="st-front" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#241913" /><stop offset="1" stopColor="#0c0806" /></linearGradient>
        <linearGradient id="st-cone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: 'rgb(var(--accent))', stopOpacity: 0.28 }} /><stop offset="1" style={{ stopColor: 'rgb(var(--accent))', stopOpacity: 0 }} /></linearGradient>
        <linearGradient id="st-console" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#34343c" /><stop offset="1" stopColor="#1a1a20" /></linearGradient>
        <radialGradient id="st-screen" cx="0.5" cy="0.5" r="0.7"><stop offset="0" stopColor="#0c2a3a" /><stop offset="1" stopColor="#04080c" /></radialGradient>
        <pattern id="st-foam" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 8 L4 0 L8 8" fill="none" stroke="rgb(255 255 255 / 0.12)" strokeWidth="1" /></pattern>
        <clipPath id="st-clip-screen"><rect x="318" y="146" width="130" height="62" rx="4" /></clipPath>
        <filter id="st-glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>

      {/* room shell */}
      <rect width="640" height="400" fill="#050507" />
      <polygon points="0,0 640,0 460,60 180,60" fill="url(#st-ceil)" />
      <polygon points="180,60 460,60 460,225 180,225" fill="url(#st-wall)" />
      <polygon points="180,225 460,225 640,400 0,400" fill="url(#st-floor)" />
      <polygon points="0,0 180,60 180,225 0,400" fill="#111116" />
      <polygon points="640,0 460,60 460,225 640,400" fill="#111116" />
      <polygon points="180,225 460,225 640,400 0,400" fill="none" />

      {/* acoustic panels on both side walls */}
      {(['l', 'r'] as const).map((side) => PANELS.map(([a, b], k) => {
        const pts: [number, number][] = [wall(side, a, 0.2), wall(side, b, 0.2), wall(side, b, 0.86), wall(side, a, 0.86)];
        const red = (k + (side === 'l' ? 0 : 1)) % 2 === 0;
        return (<g key={side + k}><polygon points={poly(pts)} style={{ fill: red ? 'rgb(var(--brand-2) / 0.85)' : '#24242b' }} stroke="rgb(0 0 0 / 0.5)" strokeWidth="1" /><polygon points={poly(pts)} fill="url(#st-foam)" /></g>);
      }))}

      {/* ceiling light bars and the light they throw on the desk */}
      <polygon points="215,150 425,150 470,330 170,330" fill="url(#st-cone)" opacity="0.55" />
      {[[236, 24, 120], [334, 40, 170]].map(([x, y, w], k) => (<g key={k}><polygon points={`${x},${y} ${x + w},${y} ${x + w - 8},${y + 6} ${x + 8},${y + 6}`} fill="#fff7d6" opacity="0.95" filter="url(#st-glow)" /></g>))}

      {/* back wall: control-room window */}
      <rect x="190" y="78" width="112" height="128" rx="3" fill="#07070a" stroke="#34343c" strokeWidth="3" />
      <rect x="194" y="82" width="104" height="120" rx="2" fill="url(#st-glass)" />
      {[0, 1, 2, 3].map((k) => <rect key={k} x="204" y={92 + k * 26} width="40" height="20" rx="2" fill="#0a1218" stroke="#22394b" />)}
      {[0, 1, 2, 3].map((k) => <circle key={k} cx="212" cy={102 + k * 26} r="2" className="st-led" style={{ fill: k % 2 ? 'rgb(var(--accent))' : '#3ddc84', animationDelay: `${k * 0.35}s` }} />)}
      <polygon points="194,82 232,82 194,140" fill="rgb(255 255 255 / 0.10)" /><polygon points="240,82 262,82 194,196 194,176" fill="rgb(255 255 255 / 0.06)" />

      {/* back wall: station sign with logo */}
      <rect x="312" y="70" width="140" height="44" rx="8" fill="#050507" style={{ stroke: 'rgb(var(--accent))' }} strokeWidth="2" filter="url(#st-glow)" />
      <image href="/brand/prince-wordmark.webp" x="318" y="73" width="128" height="38" preserveAspectRatio="xMidYMid meet" />
      {/* on-air light */}
      <rect x="358" y="120" width="48" height="18" rx="4" fill="#3a0505" stroke="#ff4040" strokeWidth="1.5" className="st-onair" />
      <text x="382" y="133" textAnchor="middle" fontSize="10" fontWeight="800" fill="#ff5a5a" fontFamily="ui-sans-serif, system-ui" className="st-onair">ON AIR</text>
      {/* wavelength display */}
      <rect x="312" y="142" width="140" height="70" rx="6" fill="#06080b" stroke="#2a2a31" strokeWidth="2" />
      <rect x="318" y="146" width="130" height="62" rx="4" fill="url(#st-screen)" />
      <g clipPath="url(#st-clip-screen)">
        <g className="st-wave a"><path d={WAVE} transform="translate(318 146) scale(1 0.9)" fill="none" style={{ stroke: 'rgb(var(--accent))' }} strokeWidth="2" /></g>
        <g className="st-wave b"><path d={WAVE} transform="translate(318 160) scale(1 0.5)" fill="none" stroke="rgb(255 255 255 / 0.6)" strokeWidth="1.5" /></g>
        <g className="st-wave c"><path d={WAVE} transform="translate(318 150) scale(1 1.2)" fill="none" style={{ stroke: 'rgb(var(--brand-2))' }} strokeWidth="1.6" /></g>
      </g>
      <text x="324" y="158" fontSize="9" fontWeight="700" fill="#9ad7ff" fontFamily="ui-monospace, monospace">89.7 MHz</text>

      {/* desk */}
      <ellipse cx="320" cy="388" rx="250" ry="10" fill="#000" opacity="0.5" />
      <polygon points="205,262 435,262 520,330 120,330" fill="url(#st-desk)" />
      <polygon points="120,330 520,330 520,372 120,372" fill="url(#st-front)" />
      <line x1="120" y1="331" x2="520" y2="331" style={{ stroke: 'rgb(var(--accent))' }} strokeWidth="2.4" filter="url(#st-glow)" />
      <polygon points="205,262 435,262 440,266 200,266" fill="rgb(255 255 255 / 0.12)" />

      {/* mixing console */}
      <polygon points="226,272 414,272 470,318 170,318" fill="url(#st-console)" stroke="#4a4a54" strokeWidth="1" />
      {Array.from({ length: 10 }, (_, k) => {
        const f = k / 9;
        const xb = 240 + f * 160, xf = 200 + f * 240;
        const kp = 0.25 + ((k * 37) % 55) / 100; // fader position along the slot
        const kx = xb + (xf - xb) * kp, ky = 281 + 30 * kp;
        return (<g key={k}>
          <line x1={xb} y1="281" x2={xf} y2="311" stroke="#0a0a0d" strokeWidth="3.4" strokeLinecap="round" />
          <rect x={kx - 5 - kp * 2} y={ky - 2} width={10 + kp * 4} height={4 + kp * 2} rx="1.5" fill="#e9e9ef" stroke="#555" strokeWidth="0.6" />
          <rect x={xb - 3} y="274" width="6" height="5" rx="1" className="st-meter" style={{ fill: k % 3 === 0 ? 'rgb(var(--accent))' : '#3ddc84', animationDelay: `${(k * 0.17) % 1.2}s` }} />
        </g>);
      })}
      {[0, 1, 2].map((k) => <circle key={k} cx={246 + k * 60} cy="316" r="3" fill="#bdbdc7" />)}

      {/* desk monitor */}
      <polygon points="300,238 340,238 340,262 300,262" fill="#05080c" stroke="#3a3a42" strokeWidth="2" />
      <rect x="303" y="241" width="34" height="18" fill="url(#st-screen)" />
      {[0, 1, 2, 3, 4, 5].map((k) => <rect key={k} x={306 + k * 5} y="246" width="3" height="10" rx="1" className="st-meter" style={{ fill: 'rgb(var(--accent))', animationDelay: `${k * 0.2}s` }} />)}

      {/* boom microphones with pop filters */}
      {[{ bx: 196, mx: 256 }, { bx: 444, mx: 384 }].map(({ bx, mx }, k) => (
        <g key={k}>
          <line x1={bx} y1="268" x2={bx + (mx - bx) * 0.45} y2="222" stroke="#8a8a96" strokeWidth="3.4" strokeLinecap="round" />
          <line x1={bx + (mx - bx) * 0.45} y1="222" x2={mx} y2="240" stroke="#8a8a96" strokeWidth="3" strokeLinecap="round" />
          <circle cx={bx} cy="268" r="4" fill="#3a3a44" />
          <ellipse cx={mx} cy="246" rx="6.5" ry="11" fill="#1c1c22" stroke="#c9c9d3" strokeWidth="1.4" />
          <ellipse cx={mx} cy="243" rx="4" ry="6" fill="#4b4b57" opacity="0.8" />
          <circle cx={mx + (k ? 14 : -14)} cy="248" r="15" fill="rgb(255 255 255 / 0.05)" stroke="rgb(255 255 255 / 0.45)" strokeWidth="1.2" />
        </g>
      ))}
      {/* headphones */}
      <path d="M156 318 q-2 -22 18 -22 q20 0 18 22" fill="none" stroke="#c9c9d3" strokeWidth="3" /><rect x="150" y="314" width="9" height="14" rx="3" fill="#15151a" stroke="#c9c9d3" /><rect x="189" y="314" width="9" height="14" rx="3" fill="#15151a" stroke="#c9c9d3" />
      <path d="M446 318 q-2 -22 18 -22 q20 0 18 22" fill="none" stroke="#c9c9d3" strokeWidth="3" /><rect x="440" y="314" width="9" height="14" rx="3" fill="#15151a" stroke="#c9c9d3" /><rect x="479" y="314" width="9" height="14" rx="3" fill="#15151a" stroke="#c9c9d3" />

      {/* presenter chairs */}
      {[236, 404].map((x) => (<g key={x}><rect x={x - 28} y="352" width="56" height="52" rx="14" fill="#101014" stroke="#2c2c34" strokeWidth="1.5" /><rect x={x - 22} y="358" width="44" height="14" rx="7" fill="#1a1a20" /></g>))}
    </svg>
  );
}

export function AuthScene({ photo }: { photo: string }) {
  return (
    <div className="auth-scene">
      <div className="auth-stage">
        <div className="auth-studio"><Studio /></div>
        <figure className="auth-portrait">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="Portrait" width={320} height={361} decoding="async" fetchPriority="high" />
          <span className="auth-live"><i /> ON AIR</span>
        </figure>
      </div>
    </div>
  );
}
