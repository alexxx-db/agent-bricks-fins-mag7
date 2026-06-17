import type { ReactNode } from 'react';

interface PanelEmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

/** Shared empty/disabled state for workspace-panel tabs. */
export function PanelEmptyState({
  icon,
  title,
  description,
  action,
}: PanelEmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-muted-foreground/60">{icon}</div>
      <h3 className="font-medium text-sm">{title}</h3>
      <p className="max-w-xs text-muted-foreground text-xs leading-relaxed">
        {description}
      </p>
      {action}
    </div>
  );
}
