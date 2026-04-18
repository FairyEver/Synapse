import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "@/App"
import { AppConfigProvider } from "@/app-shell/config"
import { IdentityProvider } from "@/app-shell/identity-context"
import { createRendererLogger, installRendererLogForwarding } from "@/app-shell/logging"
import { AppNotificationsProvider } from "@/app-shell/notifications"
import { RepositoryManagerProvider } from "@/app-shell/repository"
import "@/styles/globals.css"

const bootstrapLogger = createRendererLogger("renderer.bootstrap")

bootstrapLogger.info("Renderer bootstrap started.")
installRendererLogForwarding()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <IdentityProvider>
      <AppConfigProvider>
        <RepositoryManagerProvider>
          <AppNotificationsProvider>
            <App />
          </AppNotificationsProvider>
        </RepositoryManagerProvider>
      </AppConfigProvider>
    </IdentityProvider>
  </StrictMode>,
)
