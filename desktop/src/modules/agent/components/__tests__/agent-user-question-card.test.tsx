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
      answers: { "question-0": "重试" },
    })
    expect(container.textContent).not.toContain("允许")
    expect(container.textContent).not.toContain("拒绝")
  })

  it("submits duplicate question text answers with stable per-question keys", async () => {
    const duplicateQuestions = [
      {
        question: "请选择处理方式",
        header: "当前文件",
        options: [
          { label: "保留当前" },
          { label: "覆盖当前" },
        ],
        multiSelect: false,
      },
      {
        question: "请选择处理方式",
        header: "目标文件",
        options: [
          { label: "保留目标" },
          { label: "覆盖目标" },
        ],
        multiSelect: false,
      },
    ]
    const onRespond: ComponentProps<typeof AgentUserQuestionCard>["onRespond"] = vi.fn(async () => undefined)
    const container = renderCard(onRespond, {
      ...questionItem,
      questions: duplicateQuestions,
      toolInputRaw: { questions: duplicateQuestions },
    })

    act(() => {
      optionButton(container, "覆盖当前").click()
      optionButton(container, "保留目标").click()
    })
    await act(async () => {
      buttonByText(container, "提交").click()
      await Promise.resolve()
    })

    expect(onRespond).toHaveBeenCalledWith("request-1", "allow", {
      questions: duplicateQuestions,
      answers: {
        "question-0": "覆盖当前",
        "question-1": "保留目标",
      },
    })
  })

  it("uses question ids and keys when submitting answers", async () => {
    const identifiedQuestions = [
      { ...questions[0], id: "question-id" },
      {
        key: "question-key",
        question: "继续吗？",
        options: [{ label: "继续" }, { label: "停止" }],
        multiSelect: false,
      },
    ]
    const onRespond: ComponentProps<typeof AgentUserQuestionCard>["onRespond"] = vi.fn(async () => undefined)
    const container = renderCard(onRespond, {
      ...questionItem,
      questions: identifiedQuestions,
      toolInputRaw: { questions: identifiedQuestions },
    })

    act(() => {
      optionButton(container, "重试").click()
      optionButton(container, "继续").click()
    })
    await act(async () => {
      buttonByText(container, "提交").click()
      await Promise.resolve()
    })

    expect(onRespond).toHaveBeenCalledWith("request-1", "allow", {
      questions: identifiedQuestions,
      answers: { "question-id": "重试", "question-key": "继续" },
    })
  })

  it("submits multi-select answers as arrays without splitting labels on commas", async () => {
    const multiQuestions = [{
      question: "选择处理范围",
      options: [
        { label: "文档, 图片" },
        { label: "音频" },
      ],
      multiSelect: true,
    }]
    const onRespond: ComponentProps<typeof AgentUserQuestionCard>["onRespond"] = vi.fn(async () => undefined)
    const container = renderCard(onRespond, {
      ...questionItem,
      questions: multiQuestions,
      toolInputRaw: { questions: multiQuestions },
    })

    act(() => {
      optionButton(container, "文档, 图片").click()
      optionButton(container, "音频").click()
    })
    await act(async () => {
      buttonByText(container, "提交").click()
      await Promise.resolve()
    })

    expect(onRespond).toHaveBeenCalledWith("request-1", "allow", {
      questions: multiQuestions,
      answers: { "question-0": ["文档, 图片", "音频"] },
    })
  })

  it("restores answered selections as disabled controls", () => {
    const onRespond: ComponentProps<typeof AgentUserQuestionCard>["onRespond"] = vi.fn()
    const container = renderCard(onRespond, {
      ...questionItem,
      resolution: {
        status: "answered",
        resolvedAt: "2026-05-14T00:01:00.000Z",
        answers: [{ questionIndex: 0, values: ["重试"] }],
      },
    }, false)

    const selected = optionButton(container, "重试")
    const unselected = optionButton(container, "跳过")
    expect(container.textContent).toContain("已回答")
    expect(selected.dataset.state).toBe("checked")
    expect(selected.disabled).toBe(true)
    expect(unselected.dataset.state).toBe("unchecked")
    expect(container.textContent).not.toContain("提交")
  })

  it("shows unmatched persisted answers instead of dropping them", () => {
    const onRespond: ComponentProps<typeof AgentUserQuestionCard>["onRespond"] = vi.fn()
    const container = renderCard(onRespond, {
      ...questionItem,
      resolution: {
        status: "answered",
        resolvedAt: "2026-05-14T00:01:00.000Z",
        answers: [{ questionIndex: 0, values: ["外部渠道输入"] }],
      },
    }, false)

    expect(container.textContent).toContain("已回答：外部渠道输入")
  })

  it.each([
    ["skipped", "未回答"],
    ["timed_out", "已超时"],
    ["cancelled", "已停止"],
  ] as const)("renders %s resolution status", (status, label) => {
    const onRespond: ComponentProps<typeof AgentUserQuestionCard>["onRespond"] = vi.fn()
    const container = renderCard(onRespond, {
      ...questionItem,
      resolution: { status, resolvedAt: "2026-05-14T00:01:00.000Z" },
    }, false)

    expect(container.textContent).toContain(label)
    expect(container.textContent).not.toContain("提交")
  })

  it("labels legacy resolved cards without inventing an answer", () => {
    const onRespond: ComponentProps<typeof AgentUserQuestionCard>["onRespond"] = vi.fn()
    const container = renderCard(onRespond, questionItem, false)

    expect(container.textContent).toContain("已结束")
    expect(optionButton(container, "重试").dataset.state).toBe("unchecked")
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
      "未收到选择，已停止操作。",
    )
  })
})

function renderCard(
  onRespond: ComponentProps<typeof AgentUserQuestionCard>["onRespond"],
  item: SynapseAgentPermissionRequestTimelineItem = questionItem,
  pending = true,
): HTMLElement {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(
      <AgentUserQuestionCard
        item={item}
        pending={pending}
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
