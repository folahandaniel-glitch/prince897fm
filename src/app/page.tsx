import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

/** Fallback only: the edge middleware normally redirects "/" before this runs. Does no database work. */
export default async function Home() {
  redirect((await cookies()).has('ws_session') ? '/dashboard' : '/login');
}
