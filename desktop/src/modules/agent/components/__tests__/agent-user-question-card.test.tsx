/**
 * @vitest-environment jsdom
 */
import { createRoot, type Root } from "react-dom/client"
import { act } from "react"
import type { ComponentProps } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SynapseAgentPermissionRequestTimelineItem } from "@/types/agent"
import { AgentUserQuestionCard } from "../agent-user-question-card"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const trackMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ui-tracking", () => ({
  extractLabel: vi.fn(() => "button"),
  track: trackMock,
}))

const questions = [{
  question: "该怎么处理？",
  header: "处理方式",
  options: [
    { label: "跳过", description: "保持现状" },
    { label: "重试", description: "重新处理" },
  ],
  multiSelect: false,
}]

const questionItem: SynapseAgentPermissionRequestTimelineItem = {
  id: "question-1",
  kind: "permissionRequest",
  timestamp: "2026-05-14T00:00:00.000Z",
  requestId: "request-1",
  toolName: "AskUserQuestion",
  toolInputRaw: { questions },
  questions,
}

let roots: Root[] = []

beforeEach(() => {
  trackMock.mockClear()
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
})

describe("AgentUserQuestionCard", () => {
  it("renders all questions without an internal scroll container", () => {
    const onRespond: ComponentProps<typeof AgentUserQuestionCard>["onRespond"] = vi.fn()
    const container = renderCard(onRespond, {
      ...questionItem,
      questions: [
        ...questions,
        {
          question: "周末怎么安排？",
          header: "周末计划",
          options: [
            { label: "宅家休息" },
            { label: "户外运动" },
          ],
          multiSelect: true,
        },
        {
          question: "学哪门语言？",
          header: "开发语言",
          options: [
            { label: "Rust" },
            { label: "TypeScript" },
          ],
          multiSelect: false,
        },
      ],
    })

    expect(container.textContent).toContain("该怎么处理？")
    expect(container.textContent).toContain("周末怎么安排？")
    expect(container.textContent).toContain("学哪门语言？")
    expect(container.innerHTML).not.toContain("max-h-72")
  })

  it("keeps option control ids unique when request ids repeat", () => {
    const onRespond: ComponentProps<typeof AgentUserQuestionCard>["onRespond"] = vi.fn()
    const first = renderCard(onRespond, { ...questionItem, id: "old-question" })
    const second = renderCard(onRespond, { ...questionItem, id: "new-question" })
    const firstInput = first.querySelector("[id^='agent-question-']")
    const secondInput = second.querySelector("[id^='agent-question-']")
    const firstLabel = first.querySelector("label")
    const secondLabel = second.querySelector("label")

    expect(firstInput?.id).toBeTruthy()
    expect(secondInput?.id).toBeTruthy()
    expect(firstInput?.id).not.toBe(secondInput?.id)
    expect(firstLabel?.getAttribute("for")).toBe(firstInput?.id)
    expect(secondLabel?.getAttribute("for")).toBe(secondInput?.id)
  })

  it("submits selected answers as AskUserQuestion updated input", async () => {
    const onRespond: ComponentProps<typeof AgentUserQuestionCard>["onRespond"] = vi.fn(async () => undefined)
    const container = renderCard(onRespond)

    act(() => {
      optionButton(container, "重试").click()
    })
    await act(async () => {
      buttonByText(container, "提交").click()
      await Promise.resolve()
    })

    expect(onRespond).toHaveBeenCalledWith("request-1", "allow", {
      questions,
      answers: { "该怎么处理？": "重试" },
    })
    expect(container.textContent).not.toContain("允许")
    expect(container.textContent).not.toContain("拒绝")
  })

  it("can skip a pending question without treating it as approval", async () => {
    const onRespond: ComponentProps<typeof AgentUserQuestionCard>["onRespond"] = vi.fn(async () => undefined)
    const container = renderCard(onRespond)

    await act(async () => {
      buttonByText(container, "不回答").click()
      await Promise.resolve()
    })

    expect(onRespond).toHaveBeenCalledWith(
      "request-1",
      "deny",
      undefined,
      "User skipped the question.",
    )
  })
})

function renderCard(
  onRespond: ComponentProps<typeof AgentUserQuestionCard>["onRespond"],
  item: SynapseAgentPermissionRequestTimelineItem = questionItem,
): HTMLElement {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(
      <AgentUserQuestionCard
        item={item}
        pending
        isLatestPending
        onRespond={onRespond}
      />,
    )
  })
  return container
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.includes(text))
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${text}`)
  }
  return button
}

function optionButton(container: HTMLElement, text: string): HTMLButtonElement {
  const label = Array.from(container.querySelectorAll("label"))
    .find((candidate) => candidate.textContent?.includes(text))
  const button = label?.querySelector("button")
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Option not found: ${text}`)
  }
  return button
}
