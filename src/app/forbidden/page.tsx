import Link from 'next/link';

export const dynamic = 'force-dynamic'; // rendered per request so every script can carry the request's CSP nonce
export const metadata = { title: 'Not permitted' };

export default function Forbidden() {
  return (
    <main id="main" className="grid min-h-screen place-items-center p-4">
      <div className="card max-w-md text-center">
        <h1 className="text-xl font-bold">You do not have access to this page</h1>
        <p className="mt-2 text-sm text-muted">Your role does not include this permission. If you think this is a mistake, ask your administrator who approves access for your role.</p>
        <Link href="/dashboard" className="btn-primary mt-4">Back to dashboard</Link>
      </div>
    </main>
  );
}
