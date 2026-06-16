import { useState } from 'react';
import { LayoutDashboard, MessageCircleQuestion } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAppConfig } from '@/contexts/AppConfigContext';
import { PanelEmptyState } from '@/components/workspace-panel/panel-empty-state';

type DashTab = 'dashboard' | 'genie';

/**
 * Dashboard tab: embeds the published AI/BI (Lakeview) dashboard and the Genie
 * space as iframes. A sub-toggle switches between them when both are
 * configured. URLs come from /api/config (see server pro-config), derived from
 * the GENIE_SPACE_ID / AIBI_DASHBOARD_ID env vars or explicit *_EMBED_URL
 * overrides.
 */
export function DashboardView() {
  const { dashboardEmbedUrl, genieEmbedUrl } = useAppConfig();

  const available: DashTab[] = [];
  if (dashboardEmbedUrl) available.push('dashboard');
  if (genieEmbedUrl) available.push('genie');

  const [tab, setTab] = useState<DashTab>(available[0] ?? 'dashboard');
  const activeTab = available.includes(tab) ? tab : available[0];

  if (available.length === 0) {
    return (
      <PanelEmptyState
        icon={<LayoutDashboard className="h-8 w-8" />}
        title="Dashboard not configured"
        description="Set a published Genie space and/or AI/BI dashboard for this app to embed them here."
      />
    );
  }

  const url = activeTab === 'genie' ? genieEmbedUrl : dashboardEmbedUrl;

  return (
    <div className="flex h-full flex-col">
      {available.length > 1 && (
        <div className="flex items-center gap-1 border-b px-2 py-1.5">
          <Button
            variant={activeTab === 'dashboard' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() => setTab('dashboard')}
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            Dashboard
          </Button>
          <Button
            variant={activeTab === 'genie' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() => setTab('genie')}
          >
            <MessageCircleQuestion className="h-3.5 w-3.5" />
            Genie
          </Button>
        </div>
      )}

      <div className={cn('min-h-0 flex-1')}>
        {url ? (
          <iframe
            key={activeTab}
            src={url}
            title={activeTab === 'genie' ? 'Genie space' : 'AI/BI dashboard'}
            className="h-full w-full border-0"
            allow="clipboard-read; clipboard-write; fullscreen"
          />
        ) : null}
      </div>
    </div>
  );
}
