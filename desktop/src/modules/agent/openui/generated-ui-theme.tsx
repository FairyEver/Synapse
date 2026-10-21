import { useEffect, useState, type ReactNode } from "react"
import { ThemeProvider } from "@openuidev/react-ui"

export function GeneratedUiTheme({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<"light" | "dark">(() => document.documentElement.classList.contains("dark") ? "dark" : "light")
  useEffect(() => {
    const observer = new MutationObserver(() => setMode(document.documentElement.classList.contains("dark") ? "dark" : "light"))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])
  return <ThemeProvider mode={mode} cssSelector="[data-agent-generated-ui]">{children}</ThemeProvider>
}
