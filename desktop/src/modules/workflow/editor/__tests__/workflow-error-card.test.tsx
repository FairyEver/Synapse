/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { WorkflowValidationDisplayItem } from "../validation-display"
import { WorkflowErrorCard } from "../workflow-error-card"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots.length = 0
  document.body.innerHTML = ""
})

describe("WorkflowErrorCard", () => {
  it("shows a compact list, overflow count, and supports row click", async () => {
    const onSelect = vi.fn()
    await renderCard(<WorkflowErrorCard items={items()} onSelectItem={onSelect} />)

    expect(document.body.textContent).toContain("需要处理 4 处")
    expect(document.body.textContent).toContain("请选择项目")
    expect(document.body.textContent).toContain("还有 1 处")

    await act(async () => {
      buttonContaining("提示词节点", "请选择项目，或设置工作流默认项目。").click()
    })

    expect(onSelect).toHaveBeenCalledWith(items()[0])
  })

  it("collapses and reopens without losing the error count", async () => {
    await renderCard(<WorkflowErrorCard items={items()} onSelectItem={vi.fn()} />)

    await act(async () => {
      buttonByLabel("关闭错误提示").click()
    })

    expect(document.body.textContent).toContain("4 处需要处理")
    expect(document.body.textContent).not.toContain("还有 1 处")

    await act(async () => {
      buttonByText("4 处需要处理").click()
    })

    expect(document.body.textContent).toContain("需要处理 4 处")
  })
})

async function renderCard(node: ReactNode): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(node)
  })
}

function items(): WorkflowValidationDisplayItem[] {
  return [
    { id: "1", summary: "请选择项目，或设置工作流默认项目。", location: "提示词节点", nodeId: "prompt-1", fieldKey: "projectId", type: "invalid_config" },
    { id: "2", summary: "分支“兜底”需要连接到下游节点。", location: "判断", nodeId: "switch-1", type: "invalid_switch_edge" },
    { id: "3", summary: "模板变量“customer”需要添加变量绑定。", location: "结束", nodeId: "end-1", fieldKey: "variables", type: "invalid_config" },
    { id: "4", summary: "工作流不能包含循环连接。", location: "工作流", type: "cycle" },
  ]
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.replace(/\s+/g, " ").trim() === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}

function buttonByLabel(label: string): HTMLButtonElement {
  const button = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!button) throw new Error(`Button not found: ${label}`)
  return button
}

function buttonContaining(...parts: string[]): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((candidate) => parts.every((part) => candidate.textContent?.includes(part)))
  if (!button) throw new Error(`Button not found containing: ${parts.join(", ")}`)
  return button
}
