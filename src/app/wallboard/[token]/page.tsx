import { notFound } from 'next/navigation';
import { wallboardData } from '@/server/dashboards';
import { boot } from '@/server/session';
import { Screen } from './screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Wallboard', robots: { index: false, follow: false } };

export default async function Wallboard({ params }: { params: Promise<{ token: string }> }) {
  await boot();
  const { token } = await params;
  const d = await wallboardData(token);
  if (!d) notFound();
  return <Screen token={token} initial={d as any} />;
}
