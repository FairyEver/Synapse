import { useEffect, useState } from "react"

export interface UsageEChartsTheme {
  foreground: string
  mutedForeground: string
  border: string
  primary: string
  chart: string[]
}

const DEFAULT_TOKENS: UsageEChartsTheme = {
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

export function useUsageEChartsTheme(): UsageEChartsTheme {
  const [tokens, setTokens] = useState(DEFAULT_TOKENS)

  useEffect(() => {
    const updateTokens = () => {
      const styles = window.getComputedStyle(document.documentElement)
      const read = (name: string, fallback: string) =>
        normalizeCssColor(styles.getPropertyValue(name).trim() || fallback)

      setTokens({
        foreground: read("--foreground", DEFAULT_TOKENS.foreground),
        mutedForeground: read("--muted-foreground", DEFAULT_TOKENS.mutedForeground),
        border: read("--border", DEFAULT_TOKENS.border),
        primary: read("--primary", DEFAULT_TOKENS.primary),
        chart: DEFAULT_TOKENS.chart.map((fallback, index) => read(`--chart-${index + 1}`, fallback)),
      })
    }

    updateTokens()

    const observer = new MutationObserver(updateTokens)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })

    return () => {
      observer.disconnect()
    }
  }, [])

  return tokens
}

function normalizeCssColor(value: string): string {
  const parsed = parseOklch(value)
  if (!parsed) return value
  const [red, green, blue] = oklchToRgb(parsed.lightness, parsed.chroma, parsed.hue)
  return "rgb" + `(${red}, ${green}, ${blue})`
}

function parseOklch(value: string): { lightness: number; chroma: number; hue: number } | null {
  const match = /^oklch\(\s*([0-9.]+%?)\s+([0-9.]+)\s+([0-9.]+)/.exec(value)
  if (!match) return null
  const lightness = match[1].endsWith("%") ? Number.parseFloat(match[1]) / 100 : Number.parseFloat(match[1])
  const chroma = Number.parseFloat(match[2])
  const hue = Number.parseFloat(match[3])
  if (!Number.isFinite(lightness) || !Number.isFinite(chroma) || !Number.isFinite(hue)) return null
  return { lightness, chroma, hue }
}

function oklchToRgb(lightness: number, chroma: number, hue: number): [number, number, number] {
  const radians = (hue * Math.PI) / 180
  const a = chroma * Math.cos(radians)
  const b = chroma * Math.sin(radians)

  const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b
  const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b
  const sPrime = lightness - 0.0894841775 * a - 1.291485548 * b

  const l = lPrime ** 3
  const m = mPrime ** 3
  const s = sPrime ** 3

  const linearRed = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const linearGreen = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const linearBlue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s

  return [toSrgb(linearRed), toSrgb(linearGreen), toSrgb(linearBlue)]
}

function toSrgb(value: number): number {
  const clipped = Math.min(1, Math.max(0, value))
  const encoded = clipped <= 0.0031308
    ? 12.92 * clipped
    : 1.055 * clipped ** (1 / 2.4) - 0.055
  return Math.round(encoded * 255)
}
