import {
  Router,
  type Request,
  type Response,
  type Router as RouterType,
} from 'express';
import { z } from 'zod';
import { authMiddleware, requireAuth } from '../middleware/auth';
import { executeSql } from '../lib/databricks-sql';
import { getGraphTableConfig, isSqlBackedEnabled } from '../lib/pro-config';

export const graphRouter: RouterType = Router();
graphRouter.use(authMiddleware);

/**
 * GET /api/graph?focus=<nodeId>&limit=<n>
 *
 * Returns a node/edge graph derived from the graphrag_vertices / graphrag_edges
 * Delta tables (created by the optional OntoBricks GraphRAG notebook).
 *
 *  - No focus → overview: the Company nodes plus a sample of each company's most
 *    recent trading days (keeps the network legible against ~1.7k day nodes).
 *  - focus=<company|ticker|tradingDayId> → that company's subgraph (the company
 *    node + its recent trading days, chained by NEXT_DAY).
 */

const querySchema = z.object({
  focus: z.string().trim().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(7).max(600).default(150),
});

// Identifier guard for the admin-provided catalog/schema (not user input).
const IDENT = /^[A-Za-z0-9_]+$/;

interface GraphNode {
  id: string;
  type: string;
  label: string;
  ticker: string | null;
  props: Record<string, string | null>;
}

interface GraphEdge {
  source: string;
  target: string;
  type: string;
}

const NODE_COLS =
  'id, type, ticker, prop_market_cap, prop_beta, prop_pe_trailing, ' +
  'prop_pe_forward, prop_ev_ebitda, prop_date, prop_price_close, ' +
  'prop_volume, prop_daily_return';

function toNode(r: Record<string, string | null>): GraphNode {
  const isCompany = r.type === 'Company';
  return {
    id: r.id ?? '',
    type: r.type ?? 'Unknown',
    label: isCompany ? (r.ticker ?? r.id ?? '') : (r.prop_date ?? r.id ?? ''),
    ticker: r.ticker ?? null,
    props: {
      market_cap: r.prop_market_cap,
      beta: r.prop_beta,
      pe_trailing: r.prop_pe_trailing,
      pe_forward: r.prop_pe_forward,
      ev_ebitda: r.prop_ev_ebitda,
      date: r.prop_date,
      price_close: r.prop_price_close,
      volume: r.prop_volume,
      daily_return: r.prop_daily_return,
    },
  };
}

graphRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  if (!isSqlBackedEnabled()) {
    return res
      .status(503)
      .json({ error: 'Graph feature is not configured on this deployment.' });
  }

  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: 'Invalid query', details: parsed.error.flatten() });
  }
  const { focus, limit } = parsed.data;

  const { catalog, schema } = getGraphTableConfig();
  if (!IDENT.test(catalog) || !IDENT.test(schema)) {
    return res
      .status(500)
      .json({ error: 'Invalid GRAPH_CATALOG/GRAPH_SCHEMA configuration.' });
  }
  const vertices = `\`${catalog}\`.\`${schema}\`.graphrag_vertices`;
  const edges = `\`${catalog}\`.\`${schema}\`.graphrag_edges`;

  try {
    const nodes: GraphNode[] = [];

    // Resolve the focus ticker (a TradingDay id resolves to its company).
    let focusTicker: string | null = null;
    if (focus) {
      const lookup = await executeSql(
        `SELECT ticker FROM ${vertices} WHERE id = :focus LIMIT 1`,
        [{ name: 'focus', value: focus, type: 'STRING' }],
      );
      focusTicker = lookup.records[0]?.ticker ?? null;
    }

    if (focusTicker) {
      // Company subgraph: the company node + its recent trading days.
      const company = await executeSql(
        `SELECT ${NODE_COLS} FROM ${vertices} WHERE type = 'Company' AND ticker = :t`,
        [{ name: 't', value: focusTicker, type: 'STRING' }],
      );
      // `limit` is a zod-validated integer (server-controlled), safe to inline.
      const days = await executeSql(
        `SELECT ${NODE_COLS} FROM ${vertices} WHERE type = 'TradingDay' AND ticker = :t ` +
          `ORDER BY prop_date DESC LIMIT ${limit}`,
        [{ name: 't', value: focusTicker, type: 'STRING' }],
      );
      nodes.push(...company.records.map(toNode), ...days.records.map(toNode));
    } else {
      // Overview: all companies + recent K days each.
      const perCompany = Math.max(5, Math.floor(limit / 7));
      const companies = await executeSql(
        `SELECT ${NODE_COLS} FROM ${vertices} WHERE type = 'Company'`,
      );
      // perCompany is derived from the validated `limit`; safe to inline.
      const recentDays = await executeSql(
        `SELECT ${NODE_COLS} FROM (` +
          `  SELECT ${NODE_COLS}, ROW_NUMBER() OVER ` +
          `    (PARTITION BY ticker ORDER BY prop_date DESC) AS rn ` +
          `  FROM ${vertices} WHERE type = 'TradingDay'` +
          `) WHERE rn <= ${perCompany}`,
      );
      nodes.push(
        ...companies.records.map(toNode),
        ...recentDays.records.map(toNode),
      );
    }

    // Edges: fetch all (table is small) and keep only those fully inside the
    // selected node set.
    const nodeIds = new Set(nodes.map((n) => n.id));
    const allEdges = await executeSql(
      `SELECT src, dst, relationship FROM ${edges}`,
    );
    const graphEdges: GraphEdge[] = [];
    for (const e of allEdges.records) {
      if (e.src && e.dst && nodeIds.has(e.src) && nodeIds.has(e.dst)) {
        graphEdges.push({
          source: e.src,
          target: e.dst,
          type: e.relationship ?? 'RELATED',
        });
      }
    }

    res.json({ nodes, edges: graphEdges, focus: focus ?? null });
  } catch (error) {
    console.error('[/api/graph] error:', error);
    res.status(500).json({
      error:
        error instanceof Error ? error.message : 'Failed to load graph data.',
    });
  }
});
