import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BarChart3, LayoutDashboard, Share2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAppConfig } from '@/contexts/AppConfigContext';
import {
  type PanelTab,
  useWorkspacePanel,
} from '@/contexts/WorkspacePanelContext';
import { GraphView } from '@/components/graph/GraphView';
import { DataExplorerView } from '@/components/data/DataExplorerView';
import { DashboardView } from '@/components/dashboard/DashboardView';

interface TabDef {
  id: PanelTab;
  label: string;
  icon: typeof Share2;
}

const ALL_TABS: TabDef[] = [
  { id: 'graph', label: 'Graph', icon: Share2 },
  { id: 'data', label: 'Data', icon: BarChart3 },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
];

/**
 * Dockable, resizable right-hand workspace panel (pro mode only). Hosts the
 * Graph / Data / Dashboard tabs. Tabs are shown only when their backing
 * feature is enabled server-side; the active tab falls back to the first
 * enabled one.
 */
export function WorkspacePanel() {
  const { graphEnabled, dataExplorerEnabled, dashboardEnabled } =
    useAppConfig();
  const { isOpen, activeTab, focus, width, close, setActiveTab, setWidth } =
    useWorkspacePanel();

  const enabledTabs = useMemo(
    () =>
      ALL_TABS.filter((tab) => {
        if (tab.id === 'graph') return graphEnabled;
        if (tab.id === 'data') return dataExplorerEnabled;
        return dashboardEnabled;
      }),
    [graphEnabled, dataExplorerEnabled, dashboardEnabled],
  );

  // Keep the active tab valid as availability changes.
  const effectiveTab = useMemo(() => {
    if (enabledTabs.some((t) => t.id === activeTab)) return activeTab;
    return enabledTabs[0]?.id;
  }, [enabledTabs, activeTab]);

  useEffect(() => {
    if (effectiveTab && effectiveTab !== activeTab) {
      setActiveTab(effectiveTab);
    }
  }, [effectiveTab, activeTab, setActiveTab]);

  // ── Drag-to-resize (panel docked on the right; dragging left grows it) ──
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragState.current) return;
      const delta = dragState.current.startX - e.clientX;
      setWidth(dragState.current.startWidth + delta);
    },
    [setWidth],
  );

  const onPointerUp = useCallback(() => {
    dragState.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  }, [onPointerMove]);

  const startResize = useCallback(
    (e: React.PointerEvent) => {
      dragState.current = { startX: e.clientX, startWidth: width };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [width, onPointerMove, onPointerUp],
  );

  useEffect(
    () => () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    },
    [onPointerMove, onPointerUp],
  );

  if (enabledTabs.length === 0) return null;

  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.aside
          key="workspace-panel"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          style={{ width }}
          className="relative flex h-full shrink-0 flex-col border-l bg-background"
          data-testid="workspace-panel"
        >
          {/* Resize handle */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            onPointerDown={startResize}
            className="-left-1 absolute top-0 z-10 h-full w-2 cursor-col-resize hover:bg-primary/20"
          />

          {/* Tab bar */}
          <div className="flex items-center justify-between border-b px-2 py-1.5">
            <div className="flex items-center gap-1">
              {enabledTabs.map((tab) => {
                const Icon = tab.icon;
                const active = tab.id === effectiveTab;
                return (
                  <Button
                    key={tab.id}
                    variant={active ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs"
                    onClick={() => setActiveTab(tab.id)}
                    data-testid={`workspace-tab-${tab.id}`}
                    aria-pressed={active}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </Button>
                );
              })}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={close}
              aria-label="Close panel"
              data-testid="workspace-panel-close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Active view */}
          <div className={cn('min-h-0 flex-1 overflow-hidden')}>
            {effectiveTab === 'graph' && (
              <GraphView focusEntity={focus?.entity} />
            )}
            {effectiveTab === 'data' && (
              <DataExplorerView focusTicker={focus?.ticker} />
            )}
            {effectiveTab === 'dashboard' && <DashboardView />}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
