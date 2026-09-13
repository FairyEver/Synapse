/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AgentConversationOpenRequest } from "@/types/agent-navigation"
import {
  useAgentConversationOpenRequest,
  type AgentConversationOpenRequestHandler,
} from "../use-agent-conversation-open-request"

const mocks = vi.hoisted(() => ({
  acknowledge: vi.fn(async () => undefined),
  getPending: vi.fn(),
  listener: null as ((request: AgentConversationOpenRequest) => void) | null,
  logger: {
    error: vi.fn(),
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => mocks.logger,
}))

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => ({
    agent: {
      acknowledgeConversationOpenRequest: mocks.acknowledge,
      getPendingConversationOpenRequest: mocks.getPending,
      onOpenConversation: (listener: (request: AgentConversationOpenRequest) => void) => {
        mocks.listener = listener
        return () => {
          mocks.listener = null
        }
      },
    },
  }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
    root = null
  }
  document.body.innerHTML = ""
  mocks.listener = null
  vi.clearAllMocks()
})

function Harness({ handler }: { handler: AgentConversationOpenRequestHandler }) {
  useAgentConversationOpenRequest(handler)
  return null
}

function request(requestId: number): AgentConversationOpenRequest {
  return {
    requestId,
    projectId: "project-1",
    conversationId: `conversation-${requestId}`,
  }
}

describe("useAgentConversationOpenRequest", () => {
  it("subscribes before reading pending state and deduplicates by request id", async () => {
    const pending = request(1)
    mocks.getPending.mockResolvedValue(pending)
    const handler = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<Harness handler={handler} />)
      await Promise.resolve()
    })

    expect(handler).toHaveBeenCalledTimes(1)
    await act(async () => {
      mocks.listener?.(pending)
      mocks.listener?.(request(2))
      await Promise.resolve()
    })
    expect(handler).toHaveBeenCalledTimes(2)

    const controls = handler.mock.calls[0]?.[1]
    await controls.acknowledge()
    expect(mocks.acknowledge).toHaveBeenCalledWith(1)
  })
})

