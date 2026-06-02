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

const rendererLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("@/app-shell/content", () => ({
  readContent: mocks.readContent,
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
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
  rendererLogger.debug.mockClear()
  rendererLogger.error.mockClear()
  rendererLogger.info.mockClear()
  rendererLogger.warn.mockClear()
  mocks.readContent.mockClear()
  mocks.requestOpenAgentSession.mockClear()
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
    })
  })

  it("navigates to the created conversation before the prompt send completes", async () => {
    mocks.readContent.mockResolvedValue({ content: "Prompt body" })
    const sendDeferred = createDeferred()
    const send = vi.fn().mockReturnValue(sendDeferred.promise)
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

    await renderRunProbe({ navigate: true })
    await act(async () => {
      await Promise.resolve()
    })

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      sessionKey: "local:renderer",
      conversationId: "conversation-1",
      content: "Prompt body",
      providerId: "provider-1",
    }))
    expect(mocks.requestOpenAgentSession).toHaveBeenCalledWith({
      projectId: "project-1",
      conversationId: "conversation-1",
    })

    await act(async () => {
      sendDeferred.resolve({
        projectId: "project-1",
        sessionKey: "local:renderer",
        conversationId: "conversation-1",
        resultText: "",
        events: [],
      })
      await Promise.resolve()
    })
  })

  it("routes background sends to the created conversation", async () => {
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
      conversationId: "conversation-1",
      content: "Prompt body",
      providerId: "provider-1",
    }))
  })

  it("ignores concurrent run requests before the loading state rerenders", async () => {
    const readDeferred = createDeferred<{ content: string }>()
    const resultsDeferred = createDeferred<boolean[]>()
    mocks.readContent.mockReturnValue(readDeferred.promise)
    const createSession = vi.fn().mockResolvedValue({
      id: "conversation-1",
      sessionKey: "local:renderer",
    })
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
          createSession,
          send,
        },
      },
    })

    await renderConcurrentRunProbe((results) => resultsDeferred.resolve(results))
    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.readContent).toHaveBeenCalledTimes(1)

    await act(async () => {
      readDeferred.resolve({ content: "Prompt body" })
      await Promise.resolve()
    })
    await expect(resultsDeferred.promise).resolves.toEqual([true, false])
    expect(createSession).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("logs background send failures with conversation context", async () => {
    mocks.readContent.mockResolvedValue({ content: "Secret prompt body" })
    const send = vi.fn().mockRejectedValue(new Error("secret backend detail"))
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
    await act(async () => {
      await Promise.resolve()
    })

    expect(rendererLogger.error).toHaveBeenCalledWith(
      "Prompt run: send message failed.",
      expect.objectContaining({
        promptId: "prompt-1",
        projectId: "project-1",
        conversationId: "conversation-1",
        sessionKey: "local:renderer",
        agentType: "claude-code",
        providerId: "provider-1",
        boundary: "renderer.prompt-run.agent-send",
        errorName: "Error",
        errorLength: "secret backend detail".length,
      }),
    )
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("Secret prompt body")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("secret backend detail")
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

async function renderConcurrentRunProbe(onComplete: (results: boolean[]) => void) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<ConcurrentRunProbe onComplete={onComplete} />)
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

function ConcurrentRunProbe({ onComplete }: { onComplete: (results: boolean[]) => void }) {
  const { run } = usePromptRun()

  useEffect(() => {
    void Promise.all([
      run({
        item: promptItem,
        projectId: "project-1",
        agentType: "claude-code",
        providerId: "provider-1",
        navigate: false,
      }),
      run({
        item: promptItem,
        projectId: "project-1",
        agentType: "claude-code",
        providerId: "provider-1",
        navigate: true,
      }),
    ]).then(onComplete)
  }, [onComplete, run])

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

function createDeferred<T = unknown>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}
