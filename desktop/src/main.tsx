import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "@/App"
import { AppErrorBoundary } from "@/components/app-error-boundary"
import { ActiveRepositorySwitchProvider } from "@/app-shell/active-repository-switch"
import { AccountProvider } from "@/app-shell/account"
import { AppConfigProvider } from "@/app-shell/config"
import { IdentityProvider } from "@/app-shell/identity-context"
import { createRendererLogger, installRendererLogForwarding } from "@/app-shell/logging"
import { installDiagnostics } from "@/app-shell/diagnostics"
import { updateDiagnosticContext } from "@/lib/diagnostic-context"
import { AppNotificationsProvider } from "@/app-shell/notifications"
import { RepositoryManagerProvider } from "@/app-shell/repository"
import "@/styles/globals.css"

const bootstrapLogger = createRendererLogger("renderer.bootstrap")

bootstrapLogger.info("Renderer bootstrap started.")
installRendererLogForwarding()
const cleanupDiagnostics = installDiagnostics()

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cleanupDiagnostics()
  })
}

void (async () => {
  const windowType = new URLSearchParams(window.location.search).get("window")
  updateDiagnosticContext({ windowType: windowType ?? "main" })

  if (windowType === "workflow-editor") {
    const { WorkflowEditorApp } = await import("@/modules/workflow/editor/editor-app")
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <AppErrorBoundary>
          <AppConfigProvider>
            <AppNotificationsProvider>
              <WorkflowEditorApp />
            </AppNotificationsProvider>
          </AppConfigProvider>
        </AppErrorBoundary>
      </StrictMode>,
    )
  } else if (windowType === "workflow-runner") {
    const { WorkflowRunnerApp } = await import("@/modules/workflow/runner/runner-app")
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <AppErrorBoundary>
          <AppNotificationsProvider>
            <WorkflowRunnerApp />
          </AppNotificationsProvider>
        </AppErrorBoundary>
      </StrictMode>,
    )
  } else if (windowType === "knowledge-source-manager") {
    const { KnowledgeBaseSourceManagerWindow } = await import("@/modules/knowledge-base/source-manager-window")
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <AppErrorBoundary>
          <AppNotificationsProvider>
            <KnowledgeBaseSourceManagerWindow />
          </AppNotificationsProvider>
        </AppErrorBoundary>
      </StrictMode>,
    )
  } else if (windowType === "automation-editor") {
    const { AutomationEditorApp } = await import("@/modules/automation/editor/editor-app")
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <AppErrorBoundary>
          <AppConfigProvider>
            <AppNotificationsProvider>
              <AutomationEditorApp />
            </AppNotificationsProvider>
          </AppConfigProvider>
        </AppErrorBoundary>
      </StrictMode>,
    )
  } else if (windowType === "system-app") {
    const { SystemAppWindowApp } = await import("@/modules/apps/system-app-window-app")
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <AppErrorBoundary>
          <AppConfigProvider>
            <RepositoryManagerProvider>
              <IdentityProvider>
                <AppNotificationsProvider>
                  <AccountProvider>
                    <ActiveRepositorySwitchProvider>
                      <SystemAppWindowApp />
                    </ActiveRepositorySwitchProvider>
                  </AccountProvider>
                </AppNotificationsProvider>
              </IdentityProvider>
            </RepositoryManagerProvider>
          </AppConfigProvider>
        </AppErrorBoundary>
      </StrictMode>,
    )
  } else if (windowType === "screenshot-overlay") {
    const { ScreenshotOverlayApp } = await import("../app-capabilities/screenshot/renderer/overlay")
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <AppErrorBoundary>
          <ScreenshotOverlayApp />
        </AppErrorBoundary>
      </StrictMode>,
    )
  } else {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <AppErrorBoundary>
          <AppConfigProvider>
            <RepositoryManagerProvider>
              <IdentityProvider>
                <AppNotificationsProvider>
                  <AccountProvider>
                    <ActiveRepositorySwitchProvider>
                      <App />
                    </ActiveRepositorySwitchProvider>
                  </AccountProvider>
                </AppNotificationsProvider>
              </IdentityProvider>
            </RepositoryManagerProvider>
          </AppConfigProvider>
        </AppErrorBoundary>
      </StrictMode>,
    )
  }
})()
