import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/** The tabs hosted by the dockable workspace panel. */
export type PanelTab = 'graph' | 'data' | 'dashboard';

export interface PanelFocus {
  /** A graph node id / entity URI to center the graph on. */
  entity?: string;
  /** A ticker symbol to focus the data explorer on. */
  ticker?: string;
}

interface WorkspacePanelContextType {
  isOpen: boolean;
  activeTab: PanelTab;
  focus: PanelFocus | null;
  width: number;
  /** Open the panel, optionally switching tab and setting a focus target. */
  open: (tab?: PanelTab, focus?: PanelFocus | null) => void;
  close: () => void;
  toggle: () => void;
  setActiveTab: (tab: PanelTab) => void;
  setWidth: (width: number) => void;
}

const STORAGE_KEY = 'workspace-panel:state';
const DEFAULT_WIDTH = 480;
export const MIN_PANEL_WIDTH = 360;
export const MAX_PANEL_WIDTH = 900;

interface PersistedState {
  isOpen: boolean;
  activeTab: PanelTab;
  width: number;
}

function loadPersisted(): PersistedState {
  const fallback: PersistedState = {
    isOpen: false,
    activeTab: 'graph',
    width: DEFAULT_WIDTH,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      isOpen: parsed.isOpen ?? fallback.isOpen,
      activeTab: parsed.activeTab ?? fallback.activeTab,
      width: parsed.width ?? fallback.width,
    };
  } catch {
    return fallback;
  }
}

function persist(state: PersistedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota / private-mode errors
  }
}

const WorkspacePanelContext = createContext<
  WorkspacePanelContextType | undefined
>(undefined);

export function WorkspacePanelProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(loadPersisted, []);
  const [isOpen, setIsOpen] = useState(initial.isOpen);
  const [activeTab, setActiveTabState] = useState<PanelTab>(initial.activeTab);
  const [focus, setFocus] = useState<PanelFocus | null>(null);
  const [width, setWidthState] = useState(initial.width);

  const open = useCallback(
    (tab?: PanelTab, nextFocus?: PanelFocus | null) => {
      setIsOpen(true);
      if (tab) setActiveTabState(tab);
      if (nextFocus !== undefined) setFocus(nextFocus);
      persist({
        isOpen: true,
        activeTab: tab ?? activeTab,
        width,
      });
    },
    [activeTab, width],
  );

  const close = useCallback(() => {
    setIsOpen(false);
    persist({ isOpen: false, activeTab, width });
  }, [activeTab, width]);

  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      persist({ isOpen: !prev, activeTab, width });
      return !prev;
    });
  }, [activeTab, width]);

  const setActiveTab = useCallback(
    (tab: PanelTab) => {
      setActiveTabState(tab);
      persist({ isOpen: true, activeTab: tab, width });
    },
    [width],
  );

  const setWidth = useCallback(
    (next: number) => {
      const clamped = Math.min(
        MAX_PANEL_WIDTH,
        Math.max(MIN_PANEL_WIDTH, next),
      );
      setWidthState(clamped);
      persist({ isOpen, activeTab, width: clamped });
    },
    [isOpen, activeTab],
  );

  const value = useMemo<WorkspacePanelContextType>(
    () => ({
      isOpen,
      activeTab,
      focus,
      width,
      open,
      close,
      toggle,
      setActiveTab,
      setWidth,
    }),
    [
      isOpen,
      activeTab,
      focus,
      width,
      open,
      close,
      toggle,
      setActiveTab,
      setWidth,
    ],
  );

  return (
    <WorkspacePanelContext.Provider value={value}>
      {children}
    </WorkspacePanelContext.Provider>
  );
}

export function useWorkspacePanel() {
  const context = useContext(WorkspacePanelContext);
  if (context === undefined) {
    throw new Error(
      'useWorkspacePanel must be used within a WorkspacePanelProvider',
    );
  }
  return context;
}
