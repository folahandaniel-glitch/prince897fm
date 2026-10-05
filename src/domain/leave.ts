/** Leave entitlement rules (pure). Days are in half-day steps. */
const half = (n: number) => Math.round(n * 2) / 2;

/**
 * Entitlement for `year`. When `prorate` is on and the person joined during that year, only the remaining months count
 * (the joining month counts when they started on or before the 15th). Carry-in is added afterwards.
 */
export function leaveEntitlement(i: { annual: number; joinedOn: string; year: number; prorate: boolean; carryIn?: number }): number {
  let base = i.annual;
  const jy = Number(i.joinedOn.slice(0, 4));
  if (i.prorate && jy === i.year && i.annual > 0) {
    const m = Number(i.joinedOn.slice(5, 7)), d = Number(i.joinedOn.slice(8, 10));
    const months = 12 - (m - 1) - (d > 15 ? 1 : 0);
    base = half((i.annual * Math.max(0, months)) / 12);
  } else if (jy > i.year) base = 0;
  return base + Math.max(0, i.carryIn ?? 0);
}

/** Days carried from last year: what was unused, capped by policy. */
export const carryOver = (prevEntitlement: number, prevUsed: number, max: number) => Math.min(Math.max(0, max), Math.max(0, prevEntitlement - prevUsed));
