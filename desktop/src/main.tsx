import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "@/App"
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
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
  </StrictMode>,
)
