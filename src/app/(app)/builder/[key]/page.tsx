import Link from 'next/link';
import { notFound } from 'next/navigation';
import { page } from '@/server/session';
import { getEntity } from '@/server/builders';
import { need } from '@/server/ctx';
import { PageHead } from '@/components/ui';
import { EntityForm } from '../entity-form';

export const dynamic = 'force-dynamic';

export default async function EditModule({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return page(async (p) => {
    p.requireFeature('builders');
    need(p.ctx, 'builder:manage');
    if (key === 'automations' || key === 'dashboards' || key === 'wallboards' || key === 'pages') notFound();
    const e = await getEntity(p.ctx.q, key);
    if (!e) notFound();
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <PageHead title={`Edit ${e.name}`} sub={`Version ${e.version}. Changes apply immediately; removing a field archives it so existing records keep their data.`}><Link className="btn-ghost" href="/builder">← Builder</Link><Link className="btn-ghost" href={`/m/${e.key}`}>Open module</Link></PageHead>
        <div className="card"><EntityForm e={e} isNew={false} /></div>
      </div>
    );
  });
}
