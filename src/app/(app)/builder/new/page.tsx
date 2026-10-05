import Link from 'next/link';
import { page } from '@/server/session';
import { need } from '@/server/ctx';
import { PageHead } from '@/components/ui';
import { EntityForm } from '../entity-form';

export const metadata = { title: 'New module' };

export default async function NewModule() {
  return page(async (p) => {
    p.requireFeature('builders');
    need(p.ctx, 'builder:manage');
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <PageHead title="New module" sub="Describe what you want to record. Save, and it appears in the menu."><Link className="btn-ghost" href="/builder">← Builder</Link></PageHead>
        <div className="card"><EntityForm isNew /></div>
      </div>
    );
  });
}
