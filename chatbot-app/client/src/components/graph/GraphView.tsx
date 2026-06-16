import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { Vega } from 'react-vega';
import { Loader2, RotateCcw, Search, Share2 } from 'lucide-react';
import { fetcher } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PanelEmptyState } from '@/components/workspace-panel/panel-empty-state';

export interface GraphViewProps {
  /** Optional node id / entity to center on when the view opens. */
  focusEntity?: string;
  /** Compact mode is used for inline-in-chat rendering. */
  compact?: boolean;
  /** Inline graph data (skips the API fetch). Used for agent artifacts. */
  data?: GraphData;
}

export interface GraphNode {
  id: string;
  type: string;
  label: string;
  ticker: string | null;
  props: Record<string, string | null>;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  focus?: string | null;
}

const COMPANY_COLOR = '#2272B4';
const DAY_COLOR = '#9AA7B5';

/**
 * Build a Vega force-directed graph spec from node/edge data. Uses Vega (already
 * a project dependency) so no extra packages are needed. Links reference nodes
 * by integer index, per Vega's force transform.
 */
function buildSpec(
  data: GraphData,
  width: number,
  height: number,
): Record<string, unknown> {
  const idToIndex = new Map<string, number>();
  const nodeValues = data.nodes.map((n, i) => {
    idToIndex.set(n.id, i);
    return {
      index: i,
      id: n.id,
      label: n.label,
      group: n.type,
      ticker: n.ticker,
      isCompany: n.type === 'Company',
    };
  });
  const linkValues = data.edges
    .map((e) => ({
      source: idToIndex.get(e.source),
      target: idToIndex.get(e.target),
    }))
    .filter((l) => l.source !== undefined && l.target !== undefined);

  return {
    $schema: 'https://vega.github.io/schema/vega/v5.json',
    width,
    height,
    padding: 0,
    autosize: 'none',
    signals: [
      { name: 'cx', update: 'width / 2' },
      { name: 'cy', update: 'height / 2' },
      { name: 'nodeCharge', value: -38 },
      { name: 'linkDistance', value: 34 },
      { name: 'static', value: false },
      {
        description: 'Node dragging',
        name: 'fix',
        value: false,
        on: [
          {
            events: 'symbol:pointerout[!event.buttons], window:pointerup',
            update: 'false',
          },
          { events: 'symbol:pointerover', update: 'fix || true' },
          {
            events:
              '[symbol:pointerdown, window:pointerup] > window:pointermove!',
            update: 'xy()',
            force: true,
          },
        ],
      },
      {
        name: 'node',
        value: null,
        on: [
          {
            events: 'symbol:pointerover',
            update: 'fix === true ? item() : node',
          },
        ],
      },
      {
        name: 'selected',
        value: null,
        on: [{ events: 'symbol:click', update: 'datum' }],
      },
      { name: 'restart', value: false, on: [{ events: { signal: 'fix' }, update: 'fix && fix.length' }] },
    ],
    scales: [
      {
        name: 'color',
        type: 'ordinal',
        domain: ['Company', 'TradingDay'],
        range: [COMPANY_COLOR, DAY_COLOR],
      },
    ],
    marks: [
      {
        name: 'nodes',
        type: 'symbol',
        zindex: 1,
        from: { data: 'node-data' },
        on: [
          {
            trigger: 'fix',
            modify: 'node',
            values:
              'fix === true ? {fx: node.x, fy: node.y} : {fx: fix[0], fy: fix[1]}',
          },
          { trigger: '!fix', modify: 'node', values: '{fx: null, fy: null}' },
        ],
        encode: {
          enter: {
            fill: { scale: 'color', field: 'group' },
            stroke: { value: '#fff' },
          },
          update: {
            size: { signal: "datum.isCompany ? 360 : 60" },
            cursor: { value: 'pointer' },
            tooltip: { signal: "{'Node': datum.label, 'Type': datum.group}" },
          },
        },
        transform: [
          {
            type: 'force',
            iterations: 300,
            restart: { signal: 'restart' },
            static: { signal: 'static' },
            signal: 'force',
            forces: [
              { force: 'center', x: { signal: 'cx' }, y: { signal: 'cy' } },
              { force: 'collide', radius: 9 },
              { force: 'nbody', strength: { signal: 'nodeCharge' } },
              {
                force: 'link',
                links: 'link-data',
                distance: { signal: 'linkDistance' },
              },
            ],
          },
        ],
      },
      {
        type: 'path',
        from: { data: 'link-data' },
        interactive: false,
        encode: {
          update: { stroke: { value: '#D2DAE2' }, strokeWidth: { value: 1 } },
        },
        transform: [
          {
            type: 'linkpath',
            require: { signal: 'force' },
            shape: 'line',
            sourceX: 'datum.source.x',
            sourceY: 'datum.source.y',
            targetX: 'datum.target.x',
            targetY: 'datum.target.y',
          },
        ],
      },
      {
        type: 'text',
        from: { data: 'node-data' },
        interactive: false,
        encode: {
          enter: {
            fill: { value: '#475569' },
            fontSize: { value: 9 },
            align: { value: 'left' },
            baseline: { value: 'middle' },
          },
          update: {
            x: { field: 'x', offset: 6 },
            y: { field: 'y' },
            text: { signal: "datum.isCompany ? datum.label : ''" },
          },
        },
      },
    ],
    data: [
      { name: 'node-data', values: nodeValues },
      { name: 'link-data', values: linkValues },
    ],
  };
}

function NodeDetails({
  node,
  onExpand,
  onClose,
}: {
  node: GraphNode;
  onExpand: (target: string) => void;
  onClose: () => void;
}) {
  const entries = Object.entries(node.props).filter(
    ([, v]) => v !== null && v !== undefined && v !== '',
  );
  return (
    <div className="absolute right-2 bottom-2 z-10 w-56 rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-sm">{node.label}</p>
          <p className="text-muted-foreground text-xs">{node.type}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={onClose}
          aria-label="Close details"
        >
          ×
        </Button>
      </div>
      {entries.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
          {entries.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="truncate text-right font-mono">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <Button
        variant="secondary"
        size="sm"
        className="mt-3 h-7 w-full text-xs"
        onClick={() => onExpand(node.ticker || node.id)}
      >
        Expand {node.ticker ?? 'node'}
      </Button>
    </div>
  );
}

/**
 * Interactive knowledge-graph view rendered with Vega's force-directed layout
 * over the GraphRAG tables. Supports node drag, hover tooltips, click-to-inspect,
 * and click-to-expand (re-queries the focused company subgraph).
 */
export function GraphView({
  focusEntity,
  compact,
  data: inlineData,
}: GraphViewProps) {
  const [focus, setFocus] = useState<string | undefined>(focusEntity);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 320, height: compact ? 280 : 420 });

  useEffect(() => {
    setFocus(focusEntity);
  }, [focusEntity]);

  // Track the container size so the Vega canvas fills the panel.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () =>
      setSize({
        width: Math.max(240, el.clientWidth),
        height: Math.max(200, el.clientHeight),
      });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const apiKey = inlineData
    ? null
    : `/api/graph?limit=${compact ? 80 : 200}${focus ? `&focus=${encodeURIComponent(focus)}` : ''}`;

  const { data: fetched, error, isLoading } = useSWR<GraphData>(apiKey, fetcher);
  const data = inlineData ?? fetched;

  const selectedNode = useMemo(
    () => data?.nodes.find((n) => n.id === selectedId) ?? null,
    [data, selectedId],
  );

  const spec = useMemo(
    () => (data ? buildSpec(data, size.width, size.height) : null),
    [data, size.width, size.height],
  );

  const signalListeners = useMemo(
    () => ({
      selected: (_name: string, value: unknown) => {
        const id = (value as { id?: string } | null)?.id ?? null;
        setSelectedId(id);
      },
    }),
    [],
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (q) setFocus(q);
  };

  if (error) {
    return (
      <PanelEmptyState
        icon={<Share2 className="h-8 w-8" />}
        title="Couldn't load the graph"
        description={
          (error as Error)?.message ??
          'The graph service returned an error. Confirm the GraphRAG tables and warehouse are configured.'
        }
      />
    );
  }

  if (!inlineData && isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <PanelEmptyState
        icon={<Share2 className="h-8 w-8" />}
        title="No graph data"
        description="The knowledge graph is empty. Run the OntoBricks GraphRAG setup notebook to populate it."
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {!compact && (
        <div className="flex items-center gap-2 border-b px-2 py-1.5">
          <form onSubmit={handleSearch} className="relative flex-1">
            <Search className="-translate-y-1/2 absolute top-1/2 left-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Focus a ticker (e.g. NVDA)…"
              className="h-7 pl-7 text-xs"
            />
          </form>
          {focus && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => {
                setFocus(undefined);
                setSearchInput('');
                setSelectedId(null);
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          )}
        </div>
      )}

      <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden">
        {spec && (
          <Vega
            spec={spec as never}
            actions={false}
            signalListeners={signalListeners}
            renderer="canvas"
          />
        )}

        {/* Legend */}
        <div className="absolute top-2 left-2 z-10 flex flex-col gap-1 rounded-md border bg-background/90 px-2 py-1.5 text-xs backdrop-blur">
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: COMPANY_COLOR }}
            />
            Company
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: DAY_COLOR }}
            />
            Trading day
          </span>
        </div>

        {selectedNode && (
          <NodeDetails
            node={selectedNode}
            onExpand={(target) => {
              setFocus(target);
              setSelectedId(null);
            }}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  );
}
