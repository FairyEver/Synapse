import { useEffect, useState } from "react"

export interface EChartsThemeTokens {
  foreground: string
  mutedForeground: string
  border: string
  primary: string
  chart: string[]
}

const DEFAULT_TOKENS: EChartsThemeTokens = {
  foreground: "var(--foreground)",
  mutedForeground: "var(--muted-foreground)",
  border: "var(--border)",
  primary: "var(--primary)",
  chart: [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
  ],
}

export function useEChartsThemeTokens(): EChartsThemeTokens {
  const [tokens, setTokens] = useState(DEFAULT_TOKENS)

  useEffect(() => {
    const styles = window.getComputedStyle(document.documentElement)
    const read = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback

    setTokens({
      foreground: read("--foreground", DEFAULT_TOKENS.foreground),
      mutedForeground: read("--muted-foreground", DEFAULT_TOKENS.mutedForeground),
      border: read("--border", DEFAULT_TOKENS.border),
      primary: read("--primary", DEFAULT_TOKENS.primary),
      chart: DEFAULT_TOKENS.chart.map((fallback, index) => read(`--chart-${index + 1}`, fallback)),
    })
  }, [])

  return tokens
}
