import { useState } from 'react';
import {
  ExternalLink,
  LayoutDashboard,
  MessageCircleQuestion,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAppConfig } from '@/contexts/AppConfigContext';
import { PanelEmptyState } from '@/components/workspace-panel/panel-empty-state';

type DashTab = 'dashboard' | 'genie';

/**
 * Dashboard tab: embeds the published AI/BI (Lakeview) dashboard and the Genie
 * space as iframes. URLs come from /api/config (see server pro-config).
 *
 * NOTE on embedding: Databricks gates iframe embedding of dashboards/Genie behind
 * a workspace "approved domains" policy (CSP frame-ancestors). If the app's domain
 * (*.databricksapps.com) isn't approved, the iframe renders blank with no JS-visible
 * error (cross-origin). So we always surface an "Open in new tab" link as a reliable
 * fallback, plus a hint explaining how to enable true embedding.
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
  const label = activeTab === 'genie' ? 'Genie space' : 'AI/BI dashboard';

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-2 py-1.5">
        <div className="flex items-center gap-1">
          {available.includes('dashboard') && (
            <Button
              variant={activeTab === 'dashboard' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={() => setTab('dashboard')}
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              Dashboard
            </Button>
          )}
          {available.includes('genie') && (
            <Button
              variant={activeTab === 'genie' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={() => setTab('genie')}
            >
              <MessageCircleQuestion className="h-3.5 w-3.5" />
              Genie
            </Button>
          )}
        </div>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground text-xs hover:bg-muted hover:text-foreground"
            title={`Open ${label} in a new tab`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open
          </a>
        )}
      </div>

      <div className={cn('relative min-h-0 flex-1')}>
        {url ? (
          <iframe
            key={activeTab}
            src={url}
            title={label}
            className="h-full w-full border-0"
            allow="clipboard-read; clipboard-write; fullscreen"
          />
        ) : null}
        {/* Fallback hint: a CSP-blocked embed shows nothing, so explain + offer the link. */}
        <p className="pointer-events-none absolute inset-x-0 bottom-0 bg-background/85 px-3 py-1 text-center text-[11px] text-muted-foreground backdrop-blur">
          Blank? Embedding must be enabled for this workspace —
          {' '}
          <span className="font-medium">Settings → Security → Embed dashboards</span>
          {' '}→ approve <code>*.databricksapps.com</code>. Or use{' '}
          <span className="font-medium">Open ↗</span>.
        </p>
      </div>
    </div>
  );
}
