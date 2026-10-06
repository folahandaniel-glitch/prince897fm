import { publicBranding } from '@/server/brand-public';

/** The organisation's logo (or name) for pages that sit outside the signed-in app shell: sign-in helpers, setup, registration. */
export async function BrandMark({ className = '' }: { className?: string }) {
  const { b } = await publicBranding();
  return (
    <div className={`mb-4 flex justify-center rounded-xl bg-[#0b0b0b] px-4 py-3 ${className}`}>
      {b.logoUrl
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={b.logoUrl} alt={b.name} width={400} height={110} decoding="async" className="h-auto w-44 max-w-full" />
        : <p className="text-lg font-bold text-white">{b.name}</p>}
    </div>
  );
}
