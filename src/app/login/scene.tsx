/**
 * Decorative broadcast scene for the sign-in screen: a 3D radio set, broadcast waves rippling across a perspective floor,
 * a flowing wavelength, and the portrait. Pure SVG + CSS (no scripts, no libraries) so it stays light and works under a strict CSP.
 */
// One period is 240 units; the path is longer than the view so shifting it by exactly one period loops seamlessly.
const WAVE = (() => { let d = 'M0 60 C 40 10, 80 110, 120 60'; for (let k = 1; k <= 11; k++) d += ` S ${k * 120 + 80} ${k % 2 ? 10 : 110}, ${(k + 1) * 120} 60`; return d; })();

function Radio() {
  return (
    <svg viewBox="-10 -50 340 280" className="radio3d" role="img" aria-label="Radio set">
      <defs>
        <linearGradient id="rb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3a3a40" /><stop offset="0.55" stopColor="#17171b" /><stop offset="1" stopColor="#0b0b0d" /></linearGradient>
        <linearGradient id="rs" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style={{ stopColor: 'rgb(var(--brand-2))' }} /><stop offset="1" style={{ stopColor: 'rgb(var(--accent))' }} /></linearGradient>
        <radialGradient id="rk" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stopColor="#d9d9de" /><stop offset="1" stopColor="#4a4a52" /></radialGradient>
        <radialGradient id="rg" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stopColor="#101014" /><stop offset="1" stopColor="#050506" /></radialGradient>
        <pattern id="dots" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="4.5" cy="4.5" r="1.7" fill="#7b7b86" /></pattern>
        <clipPath id="spk"><circle cx="98" cy="132" r="54" /></clipPath>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <ellipse cx="160" cy="214" rx="130" ry="14" fill="#000" opacity="0.45" />
      {/* antenna and handle */}
      <path d="M262 62 L312 -38" stroke="#b9b9c2" strokeWidth="4" strokeLinecap="round" /><circle cx="312" cy="-40" r="6" style={{ fill: 'rgb(var(--accent))' }} filter="url(#glow)" />
      <rect x="92" y="28" width="136" height="30" rx="15" fill="none" stroke="#5b5b66" strokeWidth="8" />
      {/* body */}
      <rect x="14" y="50" width="292" height="158" rx="28" fill="url(#rb)" stroke="rgb(255 255 255 / 0.2)" strokeWidth="1.5" />
      <rect x="14" y="50" width="292" height="26" rx="26" fill="url(#rs)" opacity="0.9" />
      <path d="M30 62c40-8 200-8 260 0" stroke="rgb(255 255 255 / 0.5)" strokeWidth="1.2" fill="none" opacity="0.35" />
      {/* speaker */}
      <circle cx="98" cy="132" r="58" fill="url(#rg)" stroke="#2c2c33" strokeWidth="3" />
      <rect x="40" y="74" width="116" height="116" fill="url(#dots)" clipPath="url(#spk)" />
      {/* dial */}
      <rect x="170" y="88" width="122" height="46" rx="9" fill="#050506" stroke="#33333b" strokeWidth="2" />
      {Array.from({ length: 13 }, (_, i) => <line key={i} x1={180 + i * 8.6} y1="118" x2={180 + i * 8.6} y2={i % 4 === 0 ? '106' : '111'} stroke="#8d8d99" strokeWidth="1.2" />)}
      <text x="181" y="103" fontSize="13" fontWeight="700" style={{ fill: 'rgb(var(--accent))' }} fontFamily="ui-sans-serif, system-ui">89.7 FM</text>
      <line x1="226" y1="92" x2="226" y2="130" stroke="#ff3b3b" strokeWidth="2" className="needle" filter="url(#glow)" />
      {/* knobs */}
      <g><circle cx="205" cy="168" r="17" fill="url(#rk)" stroke="#1c1c22" strokeWidth="2" /><line x1="205" y1="168" x2="205" y2="154" stroke="#222" strokeWidth="2.4" strokeLinecap="round" /></g>
      <g><circle cx="258" cy="168" r="17" fill="url(#rk)" stroke="#1c1c22" strokeWidth="2" /><line x1="258" y1="168" x2="268" y2="159" stroke="#222" strokeWidth="2.4" strokeLinecap="round" /></g>
      <circle cx="283" cy="64" r="3.4" style={{ fill: 'rgb(var(--accent))' }} className="led" filter="url(#glow)" />
    </svg>
  );
}

export function AuthScene({ photo }: { photo: string }) {
  return (
    <div className="auth-scene" aria-hidden={false}>
      {/* broadcast ripples on a perspective floor */}
      <div className="auth-floor" aria-hidden><i /><i /><i /><i /></div>
      {/* flowing wavelength */}
      <svg className="auth-wave" viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden>
        <g className="w1"><path d={WAVE} /></g><g className="w2"><path d={WAVE} /></g><g className="w3"><path d={WAVE} /></g>
      </svg>
      <div className="auth-stage">
        <div className="auth-radio"><Radio /></div>
        <figure className="auth-portrait">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="Portrait" width={320} height={361} decoding="async" fetchPriority="high" />
          <span className="auth-live"><i /> ON AIR</span>
        </figure>
      </div>
    </div>
  );
}
