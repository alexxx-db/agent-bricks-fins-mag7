import { Outlet } from 'react-router-dom';
import { AppSidebar } from '@/components/app-sidebar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { useSession } from '@/contexts/SessionContext';
import { useAppConfig } from '@/contexts/AppConfigContext';
import { WorkspacePanelProvider } from '@/contexts/WorkspacePanelContext';
import { WorkspacePanel } from '@/components/workspace-panel/workspace-panel';

export default function ChatLayout() {
  const { session, loading } = useSession();
  const { proEnabled } = useAppConfig();
  const isCollapsed = localStorage.getItem('sidebar:state') !== 'true';

  // Wait for session to load
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // No guest mode - redirect if no session
  if (!session?.user) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="mb-4 font-bold text-2xl">Authentication Required</h1>
          <p className="text-muted-foreground">
            Please authenticate using Databricks to access this application.
          </p>
        </div>
      </div>
    );
  }

  // Get preferred username from session (if available from headers)
  const preferredUsername = session.user.preferredUsername ?? null;

  // The WorkspacePanelProvider is always mounted so the header toggle's hooks
  // are valid, but the panel + split layout only render in pro mode. Simple
  // mode renders exactly as before.
  return (
    <SidebarProvider defaultOpen={!isCollapsed}>
      <WorkspacePanelProvider>
        <AppSidebar user={session.user} preferredUsername={preferredUsername} />
        <SidebarInset>
          {proEnabled ? (
            <div className="flex h-dvh min-h-0 w-full overflow-hidden">
              <div className="relative flex min-w-0 flex-1 flex-col">
                <Outlet />
              </div>
              <WorkspacePanel />
            </div>
          ) : (
            <Outlet />
          )}
        </SidebarInset>
      </WorkspacePanelProvider>
    </SidebarProvider>
  );
}
