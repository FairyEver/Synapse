/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppsModule } from "../index"

const mocks = vi.hoisted(() => ({
  openSystemApp: vi.fn(),
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => ({
    apps: {
      openSystemApp: mocks.openSystemApp,
    },
  }),
}))

describe("AppsModule", () => {
  const roots: Root[] = []

  beforeEach(() => {
    mocks.openSystemApp.mockReset()
    document.body.innerHTML = ""
  })

  afterEach(() => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })

  it("renders the fixed system apps without management controls", async () => {
    await renderAppsModule(roots)

    expect(document.querySelector("h2")?.textContent).toBe("应用")
    expect(findButton("资源仓库")).toBeTruthy()
    expect(findButton("本地数据库")).toBeTruthy()
    expect(findButton("IDE 管理")).toBeTruthy()
    expect(findButton("用量监控")).toBeTruthy()
    expect(findButton("价格管理")).toBeTruthy()

    expect(document.querySelector("input[type='search']")).toBeNull()
    expect(document.body.textContent).not.toContain("删除")
    expect(document.body.textContent).not.toContain("重命名")
    expect(document.body.textContent).not.toContain("更换图标")
  })

  it("opens the clicked app through the bridge", async () => {
    await renderAppsModule(roots)

    await act(async () => {
      findButton("用量监控").click()
      await Promise.resolve()
    })

    expect(mocks.openSystemApp).toHaveBeenCalledWith("usage-monitor")
  })
})

async function renderAppsModule(roots: Root[]): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<AppsModule />)
    await Promise.resolve()
  })
}

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button"))
    .find((item) => item.textContent?.trim() === label)

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`)
  }

  return button
}
