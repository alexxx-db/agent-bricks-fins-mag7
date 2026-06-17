import { Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWorkspacePanel } from '@/contexts/WorkspacePanelContext';
import { GraphView, type GraphData, type GraphNode } from './GraphView';

/**
 * Try to interpret an agent tool output as graph data. Accepts a JSON string
 * or object with `nodes` + `edges` arrays, tolerating both
 * {source,target} and {src,dst} edge shapes. Returns null when the output
 * isn't graph-shaped, so non-graph tool outputs fall through unchanged.
 */
export function tryParseGraphData(output: unknown): GraphData | null {
  let value: unknown = output;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) return null;

  const nodes: GraphNode[] = [];
  for (const raw of obj.nodes) {
    if (!raw || typeof raw !== 'object') continue;
    const n = raw as Record<string, unknown>;
    const id = n.id ?? n.name;
    if (typeof id !== 'string') continue;
    nodes.push({
      id,
      type: typeof n.type === 'string' ? n.type : 'Node',
      label:
        typeof n.label === 'string'
          ? n.label
          : typeof n.ticker === 'string'
            ? n.ticker
            : id,
      ticker: typeof n.ticker === 'string' ? n.ticker : null,
      props:
        n.props && typeof n.props === 'object'
          ? (n.props as Record<string, string | null>)
          : {},
    });
  }
  if (nodes.length === 0) return null;

  const edges = obj.edges
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null;
      const e = raw as Record<string, unknown>;
      const source = (e.source ?? e.src) as unknown;
      const target = (e.target ?? e.dst) as unknown;
      if (typeof source !== 'string' || typeof target !== 'string') return null;
      return {
        source,
        target,
        type: typeof e.type === 'string' ? e.type : 'RELATED',
      };
    })
    .filter((e): e is GraphData['edges'][number] => e !== null);

  return { nodes, edges };
}

/** Compact, in-chat graph render with an affordance to open the full panel. */
export function InlineGraphArtifact({ data }: { data: GraphData }) {
  const { open } = useWorkspacePanel();
  const firstTicker =
    data.nodes.find((n) => n.ticker)?.ticker ?? data.nodes[0]?.id;

  return (
    <div className="mt-2 overflow-hidden rounded-lg border bg-background">
      <div className="flex items-center justify-between border-b px-2 py-1">
        <span className="text-muted-foreground text-xs">
          Knowledge graph · {data.nodes.length} nodes
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-xs"
          onClick={() =>
            open('graph', firstTicker ? { entity: firstTicker } : null)
          }
        >
          <Maximize2 className="h-3 w-3" />
          Open in panel
        </Button>
      </div>
      <div className="h-72">
        <GraphView data={data} compact />
      </div>
    </div>
  );
}
