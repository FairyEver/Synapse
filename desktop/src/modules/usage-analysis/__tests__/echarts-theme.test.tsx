/**
 * @vitest-environment jsdom
 */
import { useEffect } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useUsageEChartsTheme, type UsageEChartsTheme } from "../shared/echarts-theme"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

const lightVars: Record<string, string> = {
  "--foreground": "oklch(1 0 0)",
  "--muted-foreground": "oklch(0.75 0 0)",
  "--border": "oklch(0.5 0 0)",
  "--primary": "oklch(0.25 0 0)",
  "--chart-1": "oklch(0.1 0 0)",
  "--chart-2": "oklch(0.2 0 0)",
  "--chart-3": "oklch(0.3 0 0)",
  "--chart-4": "oklch(0.4 0 0)",
  "--chart-5": "oklch(0.5 0 0)",
}

const darkVars: Record<string, string> = {
  "--foreground": "oklch(0 0 0)",
  "--muted-foreground": "oklch(0.25 0 0)",
  "--border": "oklch(0.5 0 0)",
  "--primary": "oklch(0.75 0 0)",
  "--chart-1": "oklch(0.9 0 0)",
  "--chart-2": "oklch(0.8 0 0)",
  "--chart-3": "oklch(0.7 0 0)",
  "--chart-4": "oklch(0.6 0 0)",
  "--chart-5": "oklch(0.5 0 0)",
}

beforeEach(() => {
  document.documentElement.className = ""
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => ({
    getPropertyValue: (name: string) => {
      const values = element === document.documentElement && document.documentElement.classList.contains("dark")
        ? darkVars
        : lightVars
      return values[name] ?? ""
    },
  }) as CSSStyleDeclaration)
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

describe("useUsageEChartsTheme", () => {
  it("updates chart tokens when the document theme class changes", async () => {
    const snapshots: UsageEChartsTheme[] = []
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<ThemeProbe onTheme={(theme) => snapshots.push(theme)} />)
    })

    expect(snapshots.at(-1)?.foreground).toBe("rgb(255, 255, 255)")

    await act(async () => {
      document.documentElement.classList.add("dark")
      await Promise.resolve()
    })

    expect(snapshots.at(-1)?.foreground).toBe("rgb(0, 0, 0)")
    expect(snapshots.at(-1)?.chart[0]).toBe("rgb(222, 222, 222)")
  })
})

function ThemeProbe({ onTheme }: { readonly onTheme: (theme: UsageEChartsTheme) => void }) {
  const theme = useUsageEChartsTheme()

  useEffect(() => {
    onTheme(theme)
  }, [onTheme, theme])

  return null
}
