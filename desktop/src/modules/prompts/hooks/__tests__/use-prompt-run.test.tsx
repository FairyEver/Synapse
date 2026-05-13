/**
 * @vitest-environment jsdom
 */
import { act, useEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { usePromptRun } from "../use-prompt-run"
import type { SynapseContentMeta } from "@/types/content"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  readContent: vi.fn(),
  requestOpenAgentSession: vi.fn(),
}))

vi.mock("@/app-shell/content", () => ({
  readContent: mocks.readContent,
}))

vi.mock("@/app-shell/navigation", () => ({
  requestOpenAgentSession: mocks.requestOpenAgentSession,
}))

let roots: Root[] = []

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

describe("usePromptRun", () => {
  it("stores the selected provider on the created session before navigating", async () => {
    mocks.readContent.mockResolvedValue({ content: "Prompt body" })
    const createSession = vi.fn().mockResolvedValue({
      id: "conversation-1",
      sessionKey: "local:renderer",
    })
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          createSession,
          send: vi.fn(),
        },
      },
    })

    await renderRunProbe({ navigate: true })

    expect(createSession).toHaveBeenCalledWith({
      projectId: "project-1",
      name: expect.stringContaining("Prompt One"),
      agentType: "claude-code",
      providerId: "provider-1",
    })
    expect(mocks.requestOpenAgentSession).toHaveBeenCalledWith({
      projectId: "project-1",
      conversationId: "conversation-1",
      prompt: "Prompt body",
    })
  })

  it("passes the selected provider to background sends", async () => {
    mocks.readContent.mockResolvedValue({ content: "Prompt body" })
    const send = vi.fn().mockResolvedValue({
      projectId: "project-1",
      sessionKey: "local:renderer",
      conversationId: "conversation-1",
      resultText: "",
      events: [],
    })
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          createSession: vi.fn().mockResolvedValue({
            id: "conversation-1",
            sessionKey: "local:renderer",
          }),
          send,
        },
      },
    })

    await renderRunProbe({ navigate: false })

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      sessionKey: "local:renderer",
      content: "Prompt body",
      providerId: "provider-1",
    }))
  })
})

async function renderRunProbe({ navigate }: { navigate: boolean }) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<RunProbe navigate={navigate} />)
  })
}

function RunProbe({ navigate }: { navigate: boolean }) {
  const { run } = usePromptRun()

  useEffect(() => {
    void run({
      item: promptItem,
      projectId: "project-1",
      agentType: "claude-code",
      providerId: "provider-1",
      navigate,
    })
  }, [navigate, run])

  return null
}

const promptItem: SynapseContentMeta<"prompt"> = {
  attachmentCount: 0,
  category: "general",
  createdAt: "2026-05-13T00:00:00.000Z",
  createdBy: "user-1",
  createdByDisplayName: "User",
  deleted: false,
  description: "Prompt description",
  icon: "file",
  iconBg: "muted",
  id: "prompt-1",
  latestHistoryDirname: "20260513000000",
  modifiedAt: "2026-05-13T00:00:00.000Z",
  modifiedBy: "user-1",
  modifiedByDisplayName: "User",
  title: "Prompt One",
  type: "prompt",
}
