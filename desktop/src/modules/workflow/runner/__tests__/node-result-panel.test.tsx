/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { NodeRunResult } from "@/types/workflow"
import { MARKDOWN_BODY_CLASSNAME } from "@/components/markdown-viewer"
import { NodeResultPanel } from "../node-result-panel"

const track = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ui-tracking", () => ({
  extractLabel: () => "button",
  track,
}))

const warn = vi.hoisted(() => vi.fn())

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ warn }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.innerHTML = ""
  track.mockClear()
  warn.mockClear()
})

describe("NodeResultPanel", () => {
  it("tracks close actions with node metadata without raw result content", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    const onClose = vi.fn()

    await act(async () => {
      root.render(
        <NodeResultPanel
          result={nodeResult()}
          nodeName="Prompt node"
          onClose={onClose}
        />,
      )
    })

    const closeButton = container.querySelector("button")
    expect(closeButton).toBeInstanceOf(HTMLButtonElement)

    await act(async () => {
      closeButton?.click()
    })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith({
      component: "workflow.runner",
      name: "workflow-runner-node-result-close",
      action: "close",
      value: "node-1",
      metadata: {
        boundary: "renderer.workflow.runner.node-result",
        nodeId: "node-1",
        status: "failed",
        hasOutput: true,
        hasError: true,
        hasPrompt: true,
        variableCount: 1,
        outputLength: 32,
        errorLength: 36,
        promptLength: 30,
      },
    })
    expect(JSON.stringify(track.mock.calls)).not.toContain("token=secret-value")
    expect(JSON.stringify(track.mock.calls)).not.toContain("raw backend error")
    expect(JSON.stringify(track.mock.calls)).not.toContain("prompt body")

    await act(async () => {
      root.unmount()
    })
  })

  it("renders non-JSON-safe structured outputs without crashing", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    const result = nodeResult()
    const cyclic: Record<string, unknown> = { label: "cyclic" }
    cyclic.self = cyclic

    await act(async () => {
      root.render(
        <NodeResultPanel
          result={{ ...result, outputs: { big: BigInt(1), cyclic } }}
          nodeName="Prompt node"
          onClose={vi.fn()}
        />,
      )
    })

    expect(container.textContent).toContain("1")
    expect(container.textContent).toContain("[Circular]")

    await act(async () => {
      root.unmount()
    })
  })

  it("hides structured markdown output when it duplicates the primary output", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <NodeResultPanel
          result={{
            ...nodeResult(),
            output: "# Source\n\nBody",
            outputs: {
              markdown: "# Source\n\nBody",
              sourcePath: "/tmp/source.docx",
              format: "docx",
            },
          }}
          nodeName="File conversion"
          onClose={vi.fn()}
        />,
      )
    })

    const fieldLabels = Array.from(container.querySelectorAll("span")).map((node) => node.textContent)
    expect(fieldLabels).not.toContain("markdown")
    expect(fieldLabels).toContain("sourcePath")
    expect(fieldLabels).toContain("format")

    await act(async () => {
      root.unmount()
    })
  })

  it("renders content sections as markdown by default and can switch to plain text", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <NodeResultPanel
          result={{
            ...nodeResult(),
            input: {
              variables: { final: "## Final\n\n**ok**" },
              prompt: "### Prompt\n\n**ready**",
            },
            output: "### Output\n\n**done**",
            error: undefined,
          }}
          nodeName="Prompt node"
          onClose={vi.fn()}
        />,
      )
    })

    expect(container.querySelector(".markdown-viewer")).not.toBeNull()
    expect(container.querySelector("h2")?.textContent).toBe("Final")
    expect(container.querySelector("strong")?.textContent).toBe("ok")

    const finalSection = Array.from(container.querySelectorAll("section"))
      .find((candidate) => candidate.textContent?.includes("$final"))
    expect(finalSection).toBeInstanceOf(HTMLElement)
    const finalLabel = Array.from(finalSection?.querySelectorAll("span") ?? [])
      .find((candidate) => candidate.textContent === "$final")
    const finalField = finalLabel?.parentElement
    expect(finalField?.className).toContain("flex-col")
    expect(finalField?.children[0]).toBe(finalLabel)
    expect(finalField?.children[1]?.querySelector(".markdown-viewer")).not.toBeNull()

    const collapseButton = Array.from(finalSection?.querySelectorAll("button") ?? [])
      .find((candidate) => candidate.getAttribute("aria-label") === "折叠输入变量")
    expect(collapseButton).toBeInstanceOf(HTMLButtonElement)

    const plainToggle = Array.from(finalSection?.querySelectorAll("button") ?? [])
      .find((candidate) => candidate.textContent === "文本")
    expect(plainToggle).toBeInstanceOf(HTMLButtonElement)

    await act(async () => {
      plainToggle?.click()
    })

    expect(finalSection?.querySelector(".markdown-viewer")).toBeNull()
    const plainFinalLabel = Array.from(finalSection?.querySelectorAll("span") ?? [])
      .find((candidate) => candidate.textContent === "$final")
    const plainFinalField = plainFinalLabel?.parentElement
    expect(plainFinalField?.children[0]).toBe(plainFinalLabel)
    expect(plainFinalField?.children[1]?.textContent).toContain("## Final")

    await act(async () => {
      collapseButton?.click()
    })

    expect(collapseButton?.getAttribute("aria-expanded")).toBe("false")
    expect(finalSection?.textContent).not.toContain("## Final")

    await act(async () => {
      root.unmount()
    })
  })

  it("constrains rendered markdown output so long content can wrap inside the panel", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <NodeResultPanel
          result={{
            ...nodeResult(),
            output: [
              "Inline `{\"url\":\"https://example.test/path/with/a/very/long/unbroken/query/string/that/should/wrap\"}`",
              "",
              "```json",
              "{\"url\":\"https://example.test/path/with/a/very/long/unbroken/query/string/that/should/wrap\"}",
              "```",
            ].join("\n"),
            error: undefined,
          }}
          nodeName="Prompt node"
          onClose={vi.fn()}
        />,
      )
    })

    const markdownViewer = container.querySelector(".markdown-viewer")
    expect(markdownViewer).toBeInstanceOf(HTMLDivElement)
    const outputFrame = markdownViewer?.parentElement

    expect(outputFrame?.className).toContain("min-w-0")
    expect(outputFrame?.className).toContain("max-w-full")
    expect(outputFrame?.className).toContain("overflow-hidden")
    expect(markdownViewer?.className).toContain("max-w-full")
    expect(MARKDOWN_BODY_CLASSNAME).toContain("[&_code]:break-all")
    expect(MARKDOWN_BODY_CLASSNAME).toContain("[&_pre]:overflow-hidden")
    expect(MARKDOWN_BODY_CLASSNAME).toContain("[&_pre_code]:break-all")

    await act(async () => {
      root.unmount()
    })
  })

  it("copies the selected node report from the panel header", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    const onCopyNodeReport = vi.fn(async () => {})

    await act(async () => {
      root.render(
        <NodeResultPanel
          result={nodeResult()}
          nodeName="Prompt node"
          onClose={vi.fn()}
          onCopyNodeReport={onCopyNodeReport}
        />,
      )
    })

    const copyButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("复制"))
    expect(copyButton).toBeInstanceOf(HTMLButtonElement)

    await act(async () => {
      copyButton?.click()
      await Promise.resolve()
    })

    expect(onCopyNodeReport).toHaveBeenCalledTimes(1)

    await act(async () => {
      root.unmount()
    })
  })

  it("renders token usage when present", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <NodeResultPanel
          result={{
            ...nodeResult(),
            usage: {
              input_tokens: 1234,
              output_tokens: 56,
              cache_read_input_tokens: 7890,
              cache_creation_input_tokens: 12,
            },
            costUsd: 0.01,
          }}
          nodeName="Prompt node"
          onClose={vi.fn()}
        />,
      )
    })

    expect(container.textContent).toContain("输入")
    expect(container.textContent).toContain("1,234")
    expect(container.textContent).toContain("输出")
    expect(container.textContent).toContain("56")
    expect(container.textContent).toContain("缓存读")
    expect(container.textContent).toContain("7,890")
    expect(container.textContent).toContain("缓存写")
    expect(container.textContent).toContain("12")
    expect(container.textContent).toContain("费用")
    expect(container.textContent).toContain("$0.01")

    await act(async () => {
      root.unmount()
    })
  })
})

function nodeResult(): NodeRunResult {
  return {
    nodeId: "node-1",
    status: "failed",
    input: {
      variables: { userInput: "token=secret-value" },
      prompt: "prompt body token=secret-value",
    },
    output: "result output token=secret-value",
    error: "raw backend error token=secret-value",
  }
}
