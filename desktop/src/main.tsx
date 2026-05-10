import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "@/App"
import { AppErrorBoundary } from "@/components/app-error-boundary"
import { ActiveRepositorySwitchProvider } from "@/app-shell/active-repository-switch"
import { AppConfigProvider } from "@/app-shell/config"
import { IdentityProvider } from "@/app-shell/identity-context"
import { LicenseProvider } from "@/app-shell/license"
import { createRendererLogger, installRendererLogForwarding } from "@/app-shell/logging"
import { AppNotificationsProvider } from "@/app-shell/notifications"
import { RepositoryManagerProvider } from "@/app-shell/repository"
import "@/styles/globals.css"

const bootstrapLogger = createRendererLogger("renderer.bootstrap")

bootstrapLogger.info("Renderer bootstrap started.")
installRendererLogForwarding()

void (async () => {
  const windowType = new URLSearchParams(window.location.search).get("window")

  if (windowType === "workflow-editor") {
    const { WorkflowEditorApp } = await import("@/modules/workflow/editor/editor-app")
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <AppErrorBoundary>
          <WorkflowEditorApp />
        </AppErrorBoundary>
      </StrictMode>,
    )
  } else {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <AppErrorBoundary>
          <AppConfigProvider>
            <RepositoryManagerProvider>
              <LicenseProvider>
                <IdentityProvider>
                  <AppNotificationsProvider>
                    <ActiveRepositorySwitchProvider>
                      <App />
                    </ActiveRepositorySwitchProvider>
                  </AppNotificationsProvider>
                </IdentityProvider>
              </LicenseProvider>
            </RepositoryManagerProvider>
          </AppConfigProvider>
        </AppErrorBoundary>
      </StrictMode>,
    )
  }
})()
