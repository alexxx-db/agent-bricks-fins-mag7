import { getWorkspaceHostname } from '@chat-template/ai-sdk-providers';

/**
 * Pro-mode configuration.
 *
 * The app ships in two flavors selected by the APP_MODE env var:
 *   "simple" (default) — chat only.
 *   "pro"              — adds the workspace panel (graph / data / dashboard)
 *                        and a richer streaming experience.
 *
 * Every pro feature is independently gated on the presence of its backing
 * configuration, so a half-configured pro deploy degrades gracefully instead
 * of erroring. Simple mode requires none of these env vars.
 */

export type AppMode = 'simple' | 'pro';

export function getAppMode(): AppMode {
  return process.env.APP_MODE === 'pro' ? 'pro' : 'simple';
}

export function isProMode(): boolean {
  return getAppMode() === 'pro';
}

/** Catalog/schema/warehouse used to read graphrag_* and ticker_data tables. */
export interface GraphTableConfig {
  catalog: string;
  schema: string;
  warehouseId: string;
}

export function getGraphTableConfig(): GraphTableConfig {
  return {
    catalog: process.env.GRAPH_CATALOG ?? '',
    schema: process.env.GRAPH_SCHEMA ?? '',
    warehouseId: process.env.DATABRICKS_WAREHOUSE_ID ?? '',
  };
}

/**
 * Whether the SQL-backed views (graph, data explorer) can run. They need a
 * warehouse plus a catalog/schema to query.
 */
export function isSqlBackedEnabled(): boolean {
  const { catalog, schema, warehouseId } = getGraphTableConfig();
  return Boolean(catalog && schema && warehouseId);
}

function normalizeHost(host: string): string {
  const withScheme = host.startsWith('http') ? host : `https://${host}`;
  return withScheme.replace(/\/$/, '');
}

export interface EmbedUrls {
  /** Genie space embed URL, or null when not configured. */
  genieUrl: string | null;
  /** AI/BI dashboard embed URL, or null when not configured. */
  dashboardUrl: string | null;
}

/**
 * Resolve the iframe embed URLs for the Dashboard tab. An explicit *_EMBED_URL
 * env var (the exact "published" URL copied from Databricks) always wins; we
 * otherwise derive a best-effort URL from the id + workspace host.
 */
export async function getEmbedUrls(): Promise<EmbedUrls> {
  const genieExplicit = process.env.GENIE_EMBED_URL?.trim();
  const dashExplicit = process.env.AIBI_EMBED_URL?.trim();
  const genieId = process.env.GENIE_SPACE_ID?.trim();
  const dashId = process.env.AIBI_DASHBOARD_ID?.trim();

  let host: string | null = null;
  // Only resolve the host if we actually need to derive a URL from an id.
  if ((!genieExplicit && genieId) || (!dashExplicit && dashId)) {
    try {
      host = normalizeHost(await getWorkspaceHostname());
    } catch {
      host = null;
    }
  }

  const genieUrl =
    genieExplicit ||
    (genieId && host ? `${host}/genie/rooms/${genieId}` : null);

  const dashboardUrl =
    dashExplicit ||
    (dashId && host ? `${host}/embed/dashboardsv3/${dashId}` : null);

  return { genieUrl: genieUrl || null, dashboardUrl: dashboardUrl || null };
}
