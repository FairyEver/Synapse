/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ResourceRepositoryModule } from "../index"

vi.mock("@/modules/skills", () => ({
  SkillsModule: ({ pendingContentOpenRequest }: { pendingContentOpenRequest?: { requestId: string } | null }) => (
    <div>技能内容 {pendingContentOpenRequest?.requestId}</div>
  ),
}))

vi.mock("@/modules/rules", () => ({
  RulesModule: ({ pendingContentOpenRequest }: { pendingContentOpenRequest?: { requestId: string } | null }) => (
    <div>规则内容 {pendingContentOpenRequest?.requestId}</div>
  ),
}))

vi.mock("@/modules/prompts", () => ({
  PromptsModule: () => <div>提示词内容</div>,
}))

describe("ResourceRepositoryModule", () => {
  const roots: Root[] = []

  beforeEach(() => {
    document.body.innerHTML = ""
  })

  afterEach(() => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })

  it("defaults to skills and switches between resource tabs", async () => {
    await renderResourceRepository(roots)

    expect(document.body.textContent).toContain("技能内容")

    await clickButton("规则")
    expect(document.body.textContent).toContain("规则内容")

    await clickButton("提示词")
    expect(document.body.textContent).toContain("提示词内容")
  })

  it("opens on the requested content type and forwards the pending request", async () => {
    await renderResourceRepository(roots, (
      <ResourceRepositoryModule
        initialContentOpenRequest={{
          kind: "detail",
          requestId: "request-1",
          contentType: "rule",
          contentId: "rule-1",
        }}
      />
    ))

    expect(document.body.textContent).toContain("规则内容")
    expect(document.body.textContent).toContain("request-1")
  })
})

async function renderResourceRepository(
  roots: Root[],
  element: React.ReactNode = <ResourceRepositoryModule />,
): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(element)
    await Promise.resolve()
  })
}

async function clickButton(label: string): Promise<void> {
  const button = Array.from(document.querySelectorAll("button"))
    .find((item) => item.textContent?.trim() === label)
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`)
  }

  await act(async () => {
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    button.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }))
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
    button.click()
    await Promise.resolve()
  })
}
