/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ContentOpenRequest } from "@/app-shell/content-navigation"
import type { SynapseSystemAppId } from "../types"
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

vi.mock("../components/system-app-content", async () => {
  const { useEffect } = await import("react")
  const { useSystemAppHeaderSlot } = await import("../components/system-app-header-slot")

  return {
    SystemAppContent: ({
      appId,
      onContentOpenRequest,
    }: {
      appId: SynapseSystemAppId
      onContentOpenRequest?: (request: ContentOpenRequest) => void
    }) => {
      const { setSlot } = useSystemAppHeaderSlot()

      useEffect(() => {
        setSlot({
          tabs: [
            { id: "main", label: "主视图" },
            { id: "settings", label: "设置" },
          ],
          value: "main",
          onValueChange: vi.fn(),
          actions: <button type="button">App 操作</button>,
        })
        return () => {
          setSlot(null)
        }
      }, [appId, setSlot])

      return (
        <div>
          <span data-testid="system-app-content">{appId} 内容</span>
          <button
            type="button"
            onClick={() => onContentOpenRequest?.({
              kind: "detail",
              requestId: "request-1",
              contentType: "skill",
              contentId: "skill-1",
            })}
          >
            触发内容请求
          </button>
        </div>
      )
    },
  }
})

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

    expect(document.querySelector("h2")).toBeNull()
    expect(findButton("资源仓库")).toBeTruthy()
    expect(findButton("Git")).toBeTruthy()
    expect(findButton("本地数据库")).toBeTruthy()
    expect(findButton("模板生成文档")).toBeTruthy()
    expect(findButton("终端")).toBeTruthy()
    expect(findButton("截图")).toBeTruthy()
    expect(findButton("IDE 管理")).toBeTruthy()
    expect(findButton("用量监控")).toBeTruthy()
    expect(findButton("价格管理")).toBeTruthy()
    expect(document.body.textContent).toContain("技能、规则、提示词")
    expect(document.body.textContent).toContain("仓库、提交、同步")
    expect(document.body.textContent).toContain("表、字段、数据记录")
    expect(document.body.textContent).toContain("模板与 JSON")
    expect(document.body.textContent).toContain("会话、命令输入")
    expect(document.body.textContent).toContain("屏幕截图")
    expect(document.body.textContent).toContain("编辑器扫描与安装状态")
    expect(document.body.textContent).toContain("CC 与 Codex 用量")
    expect(document.body.textContent).toContain("模型价格规则")

    expect(document.querySelector("input[type='search']")).toBeNull()
    expect(document.body.textContent).not.toContain("删除")
    expect(document.body.textContent).not.toContain("重命名")
    expect(document.body.textContent).not.toContain("更换图标")
  })

  it("uses an enter icon for app launch actions", async () => {
    await renderAppsModule(roots)

    expect(document.querySelectorAll(".lucide-chevron-right")).toHaveLength(9)
    expect(document.querySelector(".lucide-external-link")).toBeNull()
  })

  it("opens the clicked app in the current window", async () => {
    await renderAppsModule(roots)

    await act(async () => {
      findButton("用量监控").click()
      await Promise.resolve()
    })

    expect(mocks.openSystemApp).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("用量监控")
    expect(document.body.textContent).toContain("usage-monitor 内容")
    expect(document.querySelector("[data-embedded-system-app-tabs]")?.textContent).toContain("主视图")
    expect(document.querySelector("[data-embedded-system-app-actions]")?.textContent).toContain("App 操作")
    expect(document.querySelector("[data-system-app-window-toolbar]")).toBeNull()
  })

  it("opens the embedded app in a new window from the host toolbar", async () => {
    await renderAppsModule(roots)

    await act(async () => {
      findButton("用量监控").click()
      await Promise.resolve()
    })

    await act(async () => {
      findButtonByLabel("新窗口打开").click()
      await Promise.resolve()
    })

    expect(mocks.openSystemApp).toHaveBeenCalledWith("usage-monitor")
    expect(document.body.textContent).toContain("资源仓库")
    expect(document.body.textContent).not.toContain("usage-monitor 内容")
  })

  it("returns from an embedded app to the launcher", async () => {
    await renderAppsModule(roots)

    await act(async () => {
      findButton("用量监控").click()
      await Promise.resolve()
    })

    await act(async () => {
      findButtonByLabel("返回应用列表").click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("资源仓库")
    expect(document.body.textContent).not.toContain("usage-monitor 内容")
    expect(document.querySelector("[data-embedded-system-app-tabs]")).toBeNull()
    expect(document.body.textContent).not.toContain("App 操作")
  })

  it("switches embedded non-resource apps to the resource repository for content requests", async () => {
    await renderAppsModule(roots)

    await act(async () => {
      findButton("本地数据库").click()
      await Promise.resolve()
    })

    await act(async () => {
      findButton("触发内容请求").click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("资源仓库")
    expect(document.body.textContent).toContain("resource-repository 内容")
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
    .find((item) => item.textContent?.includes(label))

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`)
  }

  return button
}

function findButtonByLabel(label: string): HTMLButtonElement {
  const button = document.querySelector(`button[aria-label='${label}']`)

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`)
  }

  return button
}
