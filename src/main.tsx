import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "@/App"
import { AppConfigProvider } from "@/app-shell/config"
import { RepositoryManagerProvider } from "@/app-shell/repository"
import "@/styles/globals.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppConfigProvider>
      <RepositoryManagerProvider>
        <App />
      </RepositoryManagerProvider>
    </AppConfigProvider>
  </StrictMode>,
)
