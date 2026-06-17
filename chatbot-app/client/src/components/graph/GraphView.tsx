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
  weight?: number | null;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  focus?: string | null;
}

// Per-company palette — high contrast on a light canvas. The company hub *and*
// all of its trading-day nodes share the hue, so the 7 MAG7 clusters read as
// distinct color "galaxies" at a glance. Days inherit the hue at low opacity.
const COMPANY_PALETTE: Record<string, string> = {
  AAPL: '#2E6FB0', // blue
  MSFT: '#E8762B', // orange
  NVDA: '#4C9A2A', // nvidia green
  GOOGL: '#D6455B', // red
  META: '#7E5BB5', // purple
  AMZN: '#1FA9A0', // teal
  TSLA: '#C9A227', // gold
};
const FALLBACK_COLOR = '#8C9BAB';

export function tickerColor(ticker: string | null | undefined): string {
  return (ticker && COMPANY_PALETTE[ticker]) || FALLBACK_COLOR;
}

// Hub node types group/relate the companies — additional centers of gravity.
const INDEX_COLOR = '#0F172A'; // slate-900
const SECTOR_COLORS: Record<string, string> = {
  Technology: '#2E6FB0',
  'Communication Services': '#7E5BB5',
  'Consumer Cyclical': '#C9A227',
};
const TIER_COLORS: Record<string, string> = {
  // Beta tiers (risk).
  'Low Beta': '#4C9A2A',
  'Moderate Beta': '#C9A227',
  'High Beta': '#D6455B',
  // Valuation tiers.
  Value: '#1FA9A0',
  Core: '#3A6FB0',
  Premium: '#D6455B',
};

interface HubStyle {
  shape: string;
  color: string;
  size: number;
  halo: boolean;
}

/** Visual treatment for a hub node, keyed by its type + label. */
function hubStyle(type: string, label: string, compact: boolean): HubStyle | null {
  const s = compact ? 0.6 : 1;
  switch (type) {
    case 'Index':
      return { shape: 'circle', color: INDEX_COLOR, size: 1800 * s, halo: true };
    case 'Sector':
      return {
        shape: 'circle',
        color: SECTOR_COLORS[label] ?? FALLBACK_COLOR,
        size: 1250 * s,
        halo: true,
      };
    case 'BetaTier':
      return {
        shape: 'circle',
        color: TIER_COLORS[label] ?? FALLBACK_COLOR,
        size: 820 * s,
        halo: false,
      };
    case 'ValuationTier':
      return {
        shape: 'circle',
        color: TIER_COLORS[label] ?? FALLBACK_COLOR,
        size: 820 * s,
        halo: false,
      };
    default:
      return null;
  }
}

const toNum = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function fmtMarketCap(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toLocaleString()}`;
}

function fmtCompact(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${n}`;
}

function fmtPct(n: number | null): string {
  if (n === null) return '—';
  // Source values may be fractions (0.012) or already-percent (1.2).
  const pct = Math.abs(n) < 1 ? n * 100 : n;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

// Emoji glyph shown inside each hub chip — a quick, recognizable cue for what
// the hub represents (market index / industry / risk / valuation).
const HUB_ICON: Record<string, string> = {
  Index: '📈',
  Sector: '🏭',
  BetaTier: '⚡',
  ValuationTier: '💲',
};

/**
 * Build a Vega force-directed graph spec. Company hubs are sized by market cap
 * and drawn with a soft colored glow halo and an inset ticker label; trading-day
 * nodes are small, translucent, and share their company's hue. Uses only Vega
 * (already a project dependency) so the Apps build needs no extra packages.
 */
function buildSpec(
  data: GraphData,
  width: number,
  height: number,
  compact: boolean,
): Record<string, unknown> {
  // Market-cap range across companies → log-scaled hub area.
  const caps = data.nodes
    .filter((n) => n.type === 'Company')
    .map((n) => toNum(n.props.market_cap))
    .filter((v): v is number => v !== null && v > 0)
    .map((v) => Math.log10(v));
  const capMin = caps.length ? Math.min(...caps) : 0;
  const capMax = caps.length ? Math.max(...caps) : 1;
  const capSpan = capMax - capMin || 1;

  // Volume range across days → gentle day-node sizing.
  const vols = data.nodes
    .filter((n) => n.type === 'TradingDay')
    .map((n) => toNum(n.props.volume))
    .filter((v): v is number => v !== null && v > 0)
    .map((v) => Math.log10(v));
  const volMin = vols.length ? Math.min(...vols) : 0;
  const volMax = vols.length ? Math.max(...vols) : 1;
  const volSpan = volMax - volMin || 1;

  const hubMin = compact ? 420 : 700;
  const hubMax = compact ? 1200 : 2000;

  const idToIndex = new Map<string, number>();
  const nodeValues = data.nodes.map((n, i) => {
    idToIndex.set(n.id, i);
    const isCompany = n.type === 'Company';
    const isDay = n.type === 'TradingDay';
    const hub = isCompany || isDay ? null : hubStyle(n.type, n.label, compact);
    const mc = toNum(n.props.market_cap);
    const vol = toNum(n.props.volume);
    const ret = toNum(n.props.daily_return);
    const close = toNum(n.props.price_close);

    let nodeSize: number;
    let color: string;
    let shape = 'circle';
    let fillOpacity = 1;
    let labelText = '';
    let labelInside = false;
    let labelColor = '#334155';
    let labelSize = 0;
    let kind: 'company' | 'day' | 'hub' = 'day';

    if (isCompany) {
      const t = mc && mc > 0 ? (Math.log10(mc) - capMin) / capSpan : 0.5;
      nodeSize = lerp(hubMin, hubMax, t);
      color = tickerColor(n.ticker);
      labelText = n.ticker ?? n.label;
      labelInside = true;
      labelColor = '#ffffff';
      labelSize = compact ? 9 : 11;
      kind = 'company';
    } else if (hub) {
      nodeSize = hub.size;
      color = hub.color;
      shape = 'circle';
      labelText = n.label;
      labelInside = false;
      labelColor = '#1F2937';
      labelSize = compact ? 8 : 10;
      kind = 'hub';
    } else {
      const t = vol && vol > 0 ? (Math.log10(vol) - volMin) / volSpan : 0.4;
      nodeSize = lerp(compact ? 30 : 45, compact ? 70 : 120, t);
      color = tickerColor(n.ticker);
      fillOpacity = 0.5;
      kind = 'day';
    }

    // Label vertical offset: inside labels sit on the node; hub labels below it.
    const radius = Math.sqrt(nodeSize / Math.PI);
    const labelDy = labelInside ? 0 : radius + (compact ? 6 : 8);

    // Hubs render as a white chip with a thick colored ring + an emoji glyph;
    // companies/days are filled circles in their hue.
    const fillColor = kind === 'hub' ? '#ffffff' : color;
    const strokeColor = kind === 'hub' ? color : '#ffffff';
    const strokeW =
      kind === 'hub' ? (compact ? 2 : 3) : kind === 'day' ? 0.75 : 2;
    const icon = kind === 'hub' ? (HUB_ICON[n.type] ?? '') : '';
    const iconSize = kind === 'hub' ? Math.max(11, radius * 1.05) : 0;

    return {
      index: i,
      id: n.id,
      label: n.label,
      group: n.type,
      ticker: n.ticker,
      kind,
      isCompany,
      color,
      fillColor,
      strokeColor,
      strokeW,
      icon,
      iconSize,
      shape,
      nodeSize,
      fillOpacity,
      haloSize: kind === 'company' || hub?.halo ? nodeSize * 3.1 : 0,
      labelText,
      labelSize,
      labelColor,
      labelDy,
      labelBaseline: labelInside ? 'middle' : 'top',
      // Pre-formatted tooltip fields.
      tipTitle:
        kind === 'company'
          ? 'Company'
          : kind === 'hub'
            ? n.type
            : 'Trading day',
      mcLabel: fmtMarketCap(mc),
      beta: n.props.beta ?? '—',
      peForward: n.props.pe_forward ?? '—',
      closeLabel: close !== null ? `$${close.toFixed(2)}` : '—',
      retLabel: fmtPct(ret),
      volLabel: fmtCompact(vol),
    };
  });

  // Edge categories drive styling: 'corr' (weighted correlation web),
  // 'hub' (company→sector/tier/index scaffold), 'chain' (company→day, day→day).
  const edgeCat = (t: string): 'corr' | 'hub' | 'chain' =>
    t === 'CORRELATED_WITH'
      ? 'corr'
      : t === 'TRADED_ON' || t === 'NEXT_DAY'
        ? 'chain'
        : 'hub';

  const linkValues = data.edges
    .map((e) => {
      const w = e.weight ?? null;
      // Correlation edge width scales 1.5 → 5 over corr 0.5 → 0.8.
      const corrWidth =
        w !== null ? lerp(1.5, 5, (w - 0.5) / 0.3) : 1.5;
      return {
        source: idToIndex.get(e.source),
        target: idToIndex.get(e.target),
        type: e.type,
        cat: edgeCat(e.type),
        corrWidth,
        weightLabel: w !== null ? w.toFixed(2) : '',
      };
    })
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
      { name: 'nodeCharge', value: compact ? -45 : -95 },
      { name: 'linkDistance', value: compact ? 26 : 38 },
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
      {
        name: 'restart',
        value: false,
        on: [{ events: { signal: 'fix' }, update: 'fix && fix.length' }],
      },
    ],
    marks: [
      // 1. Glow halo behind company hubs (reads positions written by the force
      //    transform on the main node mark below).
      {
        type: 'symbol',
        zindex: 0,
        interactive: false,
        from: { data: 'node-data' },
        encode: {
          enter: { shape: { value: 'circle' } },
          update: {
            x: { field: 'x' },
            y: { field: 'y' },
            size: { field: 'haloSize' },
            fill: { field: 'color' },
            fillOpacity: { value: 0.16 },
          },
        },
      },
      // 2. Links. Three visual languages: the violet weighted correlation web,
      //    the grey company→hub scaffold, and company-hue day chains.
      {
        type: 'path',
        zindex: 1,
        from: { data: 'link-data' },
        interactive: false,
        encode: {
          update: {
            stroke: {
              signal:
                "datum.cat === 'corr' ? '#9333EA' " +
                ": datum.cat === 'hub' ? '#94A3B8' : datum.source.color",
            },
            strokeWidth: {
              signal:
                "datum.cat === 'corr' ? datum.corrWidth " +
                ": datum.cat === 'hub' ? 1.2 " +
                ": datum.type === 'TRADED_ON' ? 1 : 0.6",
            },
            strokeOpacity: {
              signal:
                "datum.cat === 'corr' ? 0.55 " +
                ": datum.cat === 'hub' ? 0.45 : 0.3",
            },
            strokeDash: {
              signal: "datum.cat === 'corr' ? [5, 3] : [1, 0]",
            },
          },
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
      // 3. Main node mark — runs the force layout; draggable + clickable.
      {
        name: 'nodes',
        type: 'symbol',
        zindex: 2,
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
          update: {
            shape: { field: 'shape' },
            size: { field: 'nodeSize' },
            fill: { field: 'fillColor' },
            fillOpacity: { field: 'fillOpacity' },
            stroke: { field: 'strokeColor' },
            strokeWidth: { field: 'strokeW' },
            cursor: { value: 'pointer' },
            tooltip: {
              signal:
                "datum.kind === 'company' " +
                "? {'Company': datum.label, 'Market cap': datum.mcLabel, 'Beta': datum.beta, 'P/E (fwd)': datum.peForward} " +
                ": datum.kind === 'hub' " +
                "? {'Group': datum.label, 'Type': datum.group} " +
                ": {'Trading day': datum.label, 'Close': datum.closeLabel, 'Return': datum.retLabel, 'Volume': datum.volLabel}",
            },
          },
        },
        transform: [
          {
            type: 'force',
            iterations: 320,
            restart: { signal: 'restart' },
            static: { signal: 'static' },
            signal: 'force',
            forces: [
              { force: 'center', x: { signal: 'cx' }, y: { signal: 'cy' } },
              { force: 'collide', radius: compact ? 9 : 12 },
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
      // 4. Labels: ticker inset on company/index hubs, names below sector/tier hubs.
      {
        type: 'text',
        zindex: 3,
        from: { data: 'node-data' },
        interactive: false,
        encode: {
          enter: {
            fontWeight: { value: 700 },
            align: { value: 'center' },
          },
          update: {
            x: { field: 'x' },
            y: { field: 'y', offset: { signal: 'datum.labelDy' } },
            baseline: { field: 'labelBaseline' },
            fill: { field: 'labelColor' },
            fontSize: { field: 'labelSize' },
            text: { field: 'labelText' },
          },
        },
      },
      // 5. Emoji glyph centered on each hub chip.
      {
        type: 'text',
        zindex: 4,
        from: { data: 'node-data' },
        interactive: false,
        encode: {
          enter: { align: { value: 'center' }, baseline: { value: 'middle' } },
          update: {
            x: { field: 'x' },
            y: { field: 'y' },
            fontSize: { field: 'iconSize' },
            text: { field: 'icon' },
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
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: tickerColor(node.ticker) }}
          />
          <div className="min-w-0">
            <p className="truncate font-medium text-sm">{node.label}</p>
            <p className="text-muted-foreground text-xs">{node.type}</p>
          </div>
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
      {node.ticker && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-3 h-7 w-full text-xs"
          onClick={() => onExpand(node.ticker || node.id)}
        >
          Expand {node.ticker}
        </Button>
      )}
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

  // Track the container size so the Vega canvas fills the panel. We measure the
  // ResizeObserver's contentRect (more reliable than clientHeight during the
  // panel's open animation) and round to whole pixels.
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
    () => (data ? buildSpec(data, size.width, size.height, !!compact) : null),
    [data, size.width, size.height, compact],
  );

  // Companies present in the current view, for the color legend.
  const companies = useMemo(() => {
    const seen = new Map<string, string>();
    for (const n of data?.nodes ?? []) {
      if (n.type === 'Company' && n.ticker && !seen.has(n.ticker)) {
        seen.set(n.ticker, tickerColor(n.ticker));
      }
    }
    return [...seen.entries()].map(([ticker, color]) => ({ ticker, color }));
  }, [data]);

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

      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{
          background:
            'radial-gradient(circle at 50% 38%, rgba(248,250,252,1) 0%, rgba(236,241,247,1) 70%, rgba(228,234,242,1) 100%)',
        }}
      >
        {spec && (
          <Vega
            spec={spec as never}
            actions={false}
            signalListeners={signalListeners}
            renderer="canvas"
          />
        )}

        {/* Per-company color legend. */}
        {companies.length > 0 && (
          <div className="absolute top-2 left-2 z-10 flex max-w-[55%] flex-wrap gap-x-2 gap-y-0.5 rounded-md border bg-background/80 px-1.5 py-1 text-[10px] backdrop-blur">
            {companies.map(({ ticker, color }) => (
              <span key={ticker} className="flex items-center gap-1">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: color }}
                />
                {ticker}
              </span>
            ))}
          </div>
        )}

        {/* Structure legend: hub shapes + the correlation web. */}
        {!compact && (
          <div className="absolute right-2 top-2 z-10 flex flex-col gap-0.5 rounded-md border bg-background/80 px-1.5 py-1 text-[10px] text-muted-foreground backdrop-blur">
            <span className="flex items-center gap-1.5">
              <span>📈</span> MAG7 index
            </span>
            <span className="flex items-center gap-1.5">
              <span>🏭</span> Sector
            </span>
            <span className="flex items-center gap-1.5">
              <span>⚡</span> Beta tier
            </span>
            <span className="flex items-center gap-1.5">
              <span>💲</span> Valuation tier
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-0 w-4 border-t-2 border-dashed"
                style={{ borderColor: '#9333EA' }}
              />
              Correlation
            </span>
          </div>
        )}

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
