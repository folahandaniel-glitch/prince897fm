import { notFound } from 'next/navigation';
import { page } from '@/server/session';
import { viewDashboard } from '@/server/dashboards';
import { WidgetGrid } from '@/components/widgets';
import { Empty, PageHead } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function DashboardView({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return page(async (p) => {
    p.requireFeature('builders');
    const d = await viewDashboard(p.ctx, slug);
    if (!d) notFound();
    return (
      <div className="space-y-4">
        <PageHead title={d.dash.name} sub={`Updated ${new Date().toLocaleTimeString(p.org.locale, { timeZone: p.org.timezone, hour: '2-digit', minute: '2-digit' })}`} />
        {d.results.length === 0 ? <Empty title="Nothing to show" text="The widgets on this dashboard are not available to you." /> : <WidgetGrid results={d.results} />}
      </div>
    );
  });
}
