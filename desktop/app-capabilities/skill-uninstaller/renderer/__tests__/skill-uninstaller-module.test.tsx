/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SkillUninstallerModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  chooseDirectory: vi.fn(),
  scan: vi.fn(),
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: (domain: string) => {
    if (domain === "skillUninstaller") {
      return {
        cancelScan: vi.fn(),
        scan: mocks.scan,
        uninstall: vi.fn(),
      }
    }
    if (domain === "repository") return { chooseDirectory: mocks.chooseDirectory }
    throw new Error(`Unexpected bridge domain: ${domain}`)
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

describe("SkillUninstallerModule", () => {
  const roots: Root[] = []

  beforeEach(() => {
    document.body.innerHTML = ""
    vi.clearAllMocks()
    mocks.chooseDirectory.mockResolvedValue(null)
  })

  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => root.unmount())
    }
  })

  it("renders editable query controls without scanning automatically", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<SkillUninstallerModule />)
      await Promise.resolve()
    })

    const nameInput = document.querySelector<HTMLInputElement>("#skill-uninstaller-name")
    const searchRootInput = document.querySelector<HTMLInputElement>("#skill-uninstaller-search-root")

    expect(nameInput).toBeInstanceOf(HTMLInputElement)
    expect(nameInput?.readOnly).toBe(false)
    expect(searchRootInput).toBeInstanceOf(HTMLInputElement)
    expect(searchRootInput?.readOnly).toBe(false)
    expect(findButton("选择")).toBeInstanceOf(HTMLButtonElement)
    expect(findButton("扫描")).toBeInstanceOf(HTMLButtonElement)
    expect(mocks.scan).not.toHaveBeenCalled()
  })
})

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === label)
}
