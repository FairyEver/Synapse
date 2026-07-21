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

  it("redacts sensitive node detail content before rendering", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <NodeResultPanel
          result={{
            ...nodeResult(),
            input: {
              variables: {
                apiKey: "plain-api-key",
                file: "/Users/liyang/private/source.txt",
              },
              prompt: "Authorization: Bearer raw-prompt-token at /Users/liyang/private/prompt.txt",
            },
            output: "result token=raw-output-token at /Users/liyang/private/output.txt",
            error: "failed with cookie=raw-cookie at /Users/liyang/private/error.txt",
            outputs: {
              headers: {
                authorization: "Bearer raw-header-token",
                "set-cookie": "sid=raw-cookie",
                "x-api-key": "raw-prefixed-api-key",
              },
              body: {
                message: "apiKey=raw-body-key",
                openai_api_key: "raw-openai-api-key",
              },
              sourcePath: "/Users/liyang/private/source.docx",
            },
          }}
          nodeName="HTTP node"
          onClose={vi.fn()}
        />,
      )
    })

    const renderedText = container.textContent ?? ""
    expect(renderedText).not.toContain("plain-api-key")
    expect(renderedText).not.toContain("raw-prompt-token")
    expect(renderedText).not.toContain("raw-output-token")
    expect(renderedText).not.toContain("raw-cookie")
    expect(renderedText).not.toContain("raw-header-token")
    expect(renderedText).not.toContain("raw-prefixed-api-key")
    expect(renderedText).not.toContain("raw-openai-api-key")
    expect(renderedText).not.toContain("raw-body-key")
    expect(renderedText).not.toContain("/Users/liyang/private")
    expect(renderedText).toContain("[redacted]")
    expect(renderedText).toContain("[path]")

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

  it("summarizes binary HTTP responses without rendering raw bytes", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    const rawBody = "PK\u0003\u0004binary-docx-content-with-a-long-unbroken-sequence"

    await act(async () => {
      root.render(
        <NodeResultPanel
          result={{
            ...nodeResult(),
            error: undefined,
            output: rawBody,
            outputs: {
              status: 200,
              headers: {
                "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "content-length": "17790",
              },
              body: rawBody,
            },
          }}
          nodeName="HTTP node"
          onClose={vi.fn()}
        />,
      )
    })

    const renderedText = container.textContent ?? ""
    const fieldLabels = Array.from(container.querySelectorAll("span")).map((node) => node.textContent)
    expect(renderedText).toContain("二进制响应未显示")
    expect(renderedText).toContain("17.4 KB")
    expect(renderedText).not.toContain(rawBody)
    expect(fieldLabels).not.toContain("body")

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

  it("distinguishes an empty-string output from a missing output", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <NodeResultPanel
          result={{
            ...nodeResult(),
            input: { variables: {} },
            output: "",
            error: undefined,
          }}
          nodeName="Text node"
          onClose={vi.fn()}
        />,
      )
    })

    expect(container.textContent).toContain("输出")
    expect(container.textContent).toContain("空字符串")
    expect(container.textContent).not.toContain("无可展示的输出")

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
    expect(outputFrame?.className).toContain("break-all")
    expect(markdownViewer?.className).toContain("max-w-full")
    expect(MARKDOWN_BODY_CLASSNAME).toContain("[&_code]:break-all")
    expect(MARKDOWN_BODY_CLASSNAME).toContain("[&_pre]:overflow-hidden")
    expect(MARKDOWN_BODY_CLASSNAME).toContain("[&_pre_code]:break-all")

    await act(async () => {
      root.unmount()
    })
  })

  it("keeps render mode controls inside width-constrained section headers", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <NodeResultPanel
          result={{
            ...nodeResult(),
            input: {
              variables: {
                selected: "{\"selected_id\":6,\"selected_titles\":[\"构建三级分层体系，支撑全域资产研判\"],\"selected_detail\":\"very-long-value\"}",
              },
            },
          }}
          nodeName="Prompt node"
          onClose={vi.fn()}
        />,
      )
    })

    const section = Array.from(container.querySelectorAll("section"))
      .find((candidate) => candidate.textContent?.includes("$selected"))
    expect(section).toBeInstanceOf(HTMLElement)

    const header = Array.from(section?.children ?? [])
      .find((candidate) => candidate instanceof HTMLElement && candidate.textContent?.includes("输入变量"))
    expect(header?.className).toContain("grid")
    expect(header?.className).toContain("grid-cols-[minmax(0,1fr)_auto]")

    const collapseButton = Array.from(section?.querySelectorAll("button") ?? [])
      .find((candidate) => candidate.getAttribute("aria-label") === "折叠输入变量")
    expect(collapseButton?.classList.contains("shrink")).toBe(true)
    expect(collapseButton?.classList.contains("shrink-0")).toBe(false)

    const toggleGroup = section?.querySelector("[data-slot='toggle-group']")
    expect(toggleGroup?.className).toContain("justify-self-end")

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

  it("opens the Agent conversation attached to the selected node result", async () => {
    const target = {
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "workflow:project-1:123",
      platform: "workflow" as const,
    }
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    const onOpenAgentConversation = vi.fn()

    await act(async () => {
      root.render(
        <NodeResultPanel
          result={{
            ...nodeResult(),
            outputs: { agentConversation: target },
          }}
          nodeName="Prompt node"
          onClose={vi.fn()}
          onOpenAgentConversation={onOpenAgentConversation}
        />,
      )
    })

    const openButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("打开对话"))
    expect(openButton).toBeInstanceOf(HTMLButtonElement)
    expect(container.textContent).not.toContain("agentConversation")

    await act(async () => {
      openButton?.click()
    })

    expect(onOpenAgentConversation).toHaveBeenCalledWith(target)

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
    expect(container.textContent).not.toContain("费用")
    expect(container.textContent).not.toContain("¥0.072")

    await act(async () => {
      root.unmount()
    })
  })

  it("renders sanitized codex debug output without duplicating secrets", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <NodeResultPanel
          result={{
            ...nodeResult(),
            error: undefined,
            output: "",
            outputs: {
              codexDebug: {
                command: "codex exec",
                args: ["exec", "--json", "-"],
                cwd: "/Users/liyang/project",
                exitCode: 0,
                signal: "SIGTERM",
                durationMs: 100,
                stdoutPath: "/tmp/stdout.log",
                lastMessagePath: "/tmp/last-message.txt",
                stderrPreview: "Authorization: Bearer raw-secret warning at /Users/liyang/project",
              },
            },
          }}
          nodeName="Codex node"
          onClose={vi.fn()}
        />,
      )
    })

    const renderedText = container.textContent ?? ""
    expect(renderedText).toContain("codex exec")
    expect(renderedText).toContain("/Users/liyang/project")
    expect(renderedText).toContain("0")
    expect(renderedText).toContain("SIGTERM")
    expect(renderedText).toContain("/tmp/stdout.log")
    expect(renderedText).toContain("/tmp/last-message.txt")
    expect(renderedText).toContain("[path]")
    expect(renderedText).toContain("warning")
    expect(renderedText).not.toContain("codexDebug")
    expect(renderedText).not.toContain("raw-secret")

    await act(async () => {
      root.unmount()
    })
  })

  it("renders sanitized claude code debug output without duplicating raw keys", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <NodeResultPanel
          result={{
            ...nodeResult(),
            error: undefined,
            output: "",
            outputs: {
              claudeCodeDebug: {
                command: "claude -p",
                args: ["-p", "[prompt]"],
                cwd: "/Users/liyang/project",
                exitCode: 0,
                durationMs: 12,
                stdoutPath: "/Users/liyang/Library/Application Support/Synapse/workflow-runs/run-1/nodes/claude-code-1/claude-code/stdout.log",
                stdoutPreview: "Authorization: Bearer sk-raw-secret\n/path=/Users/liyang/project/file.ts",
              },
            },
          }}
          nodeName="Claude Code node"
          onClose={vi.fn()}
        />,
      )
    })

    const renderedText = container.textContent ?? ""
    expect(renderedText).toContain("Claude Code 调试")
    expect(renderedText).toContain("claude -p")
    expect(renderedText).toContain("/Users/liyang/project")
    expect(renderedText).toContain("/workflow-runs/run-1/nodes/claude-code-1/claude-code/stdout.log")
    expect(renderedText).toContain("[redacted]")
    expect(renderedText).toContain("[path]")
    expect(renderedText).not.toContain("claudeCodeDebug")
    expect(renderedText).not.toContain("sk-raw-secret")

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
