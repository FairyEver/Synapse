import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createRendererLogger, installRendererLogForwarding } from "@/app-shell/logging"
import { installDiagnostics } from "@/app-shell/diagnostics"
import { updateDiagnosticContext } from "@/lib/diagnostic-context"
import { installNativeDataTrackCapture, track, updateTrackingContext } from "@/lib/ui-tracking"
import { Spinner } from "@/components/ui/spinner"
import "@/styles/globals.css"

const recoveryMode = new URLSearchParams(window.location.search).get("rendererRecovery")

if (recoveryMode) {
  createRoot(document.getElementById("root")!).render(
    <main className="flex min-h-screen items-center justify-center text-foreground">
      <div className="flex items-center gap-2" role="status">
        {recoveryMode === "loading" ? <Spinner /> : null}
        <span>{recoveryMode === "failed" ? "界面恢复失败" : "正在恢复界面…"}</span>
      </div>
    </main>,
  )
} else {
  void bootstrapRenderer()
}

async function bootstrapRenderer(): Promise<void> {
  const bootstrapLogger = createRendererLogger("renderer.bootstrap")
  bootstrapLogger.info("Renderer bootstrap started.")
  installRendererLogForwarding()
  const cleanupDiagnostics = installDiagnostics()
  const cleanupNativeDataTrackCapture = installNativeDataTrackCapture()

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      cleanupDiagnostics()
      cleanupNativeDataTrackCapture()
    })
  }

  const windowType = new URLSearchParams(window.location.search).get("window")
  updateDiagnosticContext({ windowType: windowType ?? "main" })
  updateTrackingContext({ windowType: windowType ?? "main" })
  track({
    component: "renderer",
    name: "window-open",
    action: "open",
    eventKey: "app.window.open",
    category: "lifecycle",
  })
  window.addEventListener("beforeunload", () => {
    track({
      component: "renderer",
      name: "window-close",
      action: "close",
      eventKey: "app.window.close",
      category: "lifecycle",
    })
  }, { once: true })

  if (windowType === "workflow-editor") {
    const { AppErrorBoundary } = await import("@/components/app-error-boundary")
    const { AppConfigProvider } = await import("@/app-shell/config")
    const { AppNotificationsProvider } = await import("@/app-shell/notifications")
    updateTrackingContext({ moduleId: "workflow", windowType })
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
    const { AppErrorBoundary } = await import("@/components/app-error-boundary")
    const { AppNotificationsProvider } = await import("@/app-shell/notifications")
    updateTrackingContext({ moduleId: "workflow", windowType })
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
    const { AppErrorBoundary } = await import("@/components/app-error-boundary")
    const { AppNotificationsProvider } = await import("@/app-shell/notifications")
    updateTrackingContext({ moduleId: "knowledge-base", windowType })
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
    const { AppErrorBoundary } = await import("@/components/app-error-boundary")
    const { AppConfigProvider } = await import("@/app-shell/config")
    const { AppNotificationsProvider } = await import("@/app-shell/notifications")
    updateTrackingContext({ moduleId: "automation", windowType })
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
    const { AppErrorBoundary } = await import("@/components/app-error-boundary")
    const { AppConfigProvider } = await import("@/app-shell/config")
    const { RepositoryManagerProvider } = await import("@/app-shell/repository")
    const { IdentityProvider } = await import("@/app-shell/identity-context")
    const { AppNotificationsProvider } = await import("@/app-shell/notifications")
    const { AccountProvider } = await import("@/app-shell/account")
    const { ActiveRepositorySwitchProvider } = await import("@/app-shell/active-repository-switch")
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
  } else {
    const { default: App } = await import("@/App")
    const { AppErrorBoundary } = await import("@/components/app-error-boundary")
    const { AppConfigProvider } = await import("@/app-shell/config")
    const { RepositoryManagerProvider } = await import("@/app-shell/repository")
    const { IdentityProvider } = await import("@/app-shell/identity-context")
    const { AppNotificationsProvider } = await import("@/app-shell/notifications")
    const { AccountProvider } = await import("@/app-shell/account")
    const { ActiveRepositorySwitchProvider } = await import("@/app-shell/active-repository-switch")
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
}
