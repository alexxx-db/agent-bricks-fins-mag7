import { createContext, useContext, type ReactNode } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/utils';

export type AppMode = 'simple' | 'pro';

interface ConfigResponse {
  appMode?: AppMode;
  features: {
    chatHistory: boolean;
    proMode?: boolean;
    graph?: boolean;
    dataExplorer?: boolean;
    dashboard?: boolean;
  };
  embed?: {
    genieUrl: string | null;
    dashboardUrl: string | null;
  };
}

interface AppConfigContextType {
  config: ConfigResponse | undefined;
  isLoading: boolean;
  error: Error | undefined;
  chatHistoryEnabled: boolean;
  /** True when APP_MODE=pro on the server. Gates the whole workspace panel. */
  proEnabled: boolean;
  /** Per-feature availability (each independently gated server-side). */
  graphEnabled: boolean;
  dataExplorerEnabled: boolean;
  dashboardEnabled: boolean;
  /** Iframe embed URLs for the Dashboard tab (null when not configured). */
  genieEmbedUrl: string | null;
  dashboardEmbedUrl: string | null;
}

const AppConfigContext = createContext<AppConfigContextType | undefined>(
  undefined,
);

export function AppConfigProvider({ children }: { children: ReactNode }) {
  const { data, error, isLoading } = useSWR<ConfigResponse>(
    '/api/config',
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      // Config should be loaded once and cached
      dedupingInterval: 60000, // 1 minute
    },
  );

  const value: AppConfigContextType = {
    config: data,
    isLoading,
    error,
    // Default to true until loaded to avoid breaking existing behavior
    chatHistoryEnabled: data?.features.chatHistory ?? true,
    // Pro features default OFF until loaded so simple mode never flickers
    // panel UI on first paint.
    proEnabled: data?.features.proMode ?? false,
    graphEnabled: data?.features.graph ?? false,
    dataExplorerEnabled: data?.features.dataExplorer ?? false,
    dashboardEnabled: data?.features.dashboard ?? false,
    genieEmbedUrl: data?.embed?.genieUrl ?? null,
    dashboardEmbedUrl: data?.embed?.dashboardUrl ?? null,
  };

  return (
    <AppConfigContext.Provider value={value}>
      {children}
    </AppConfigContext.Provider>
  );
}

export function useAppConfig() {
  const context = useContext(AppConfigContext);
  if (context === undefined) {
    throw new Error('useAppConfig must be used within an AppConfigProvider');
  }
  return context;
}
