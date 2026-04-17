import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "@/App"
import { AppConfigProvider } from "@/app-shell/config"
import "@/styles/globals.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppConfigProvider>
      <App />
    </AppConfigProvider>
  </StrictMode>,
)
