/** A person's picture, or their initials on a coloured disc when they have none. The ?v= hash makes a changed picture show immediately. */
export function Avatar({ userId, sha, name, size = 36, className = '' }: { userId?: string | null; sha?: string | null; name: string; size?: number; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.38) };
  if (userId && sha) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/api/avatar/${userId}?v=${sha.slice(0, 10)}`} alt={name} width={size} height={size} loading="lazy" decoding="async" style={{ width: size, height: size }} className={`shrink-0 rounded-full bg-surface object-cover ${className}`} />;
  }
  return <span aria-label={name} role="img" style={style} className={`inline-grid shrink-0 place-items-center rounded-full bg-accent/25 font-semibold text-brand ${className}`}>{initials}</span>;
}
