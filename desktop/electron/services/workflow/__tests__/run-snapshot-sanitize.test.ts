import { describe, expect, it } from "vitest"

import { sanitizeNodeResultsForSnapshot } from "../run-snapshot-sanitize"
import type { NodeRunResult } from "../../../../src/types/workflow"

describe("sanitizeNodeResultsForSnapshot", () => {
  it("removes agent conversation session keys from persisted outputs", () => {
    const result: NodeRunResult = {
      nodeId: "prompt-1",
      status: "success",
      input: { variables: {}, prompt: "hello" },
      outputs: {
        value: "done",
        agentConversation: {
          projectId: "project-1",
          conversationId: "conversation-1",
          sessionKey: "raw-agent-session-key",
          platform: "workflow",
        },
      },
    }

    const sanitized = sanitizeNodeResultsForSnapshot({ "prompt-1": result })

    expect(sanitized["prompt-1"]?.outputs).toEqual({
      value: "done",
      agentConversation: {
        projectId: "project-1",
        conversationId: "conversation-1",
        platform: "workflow",
      },
    })
    expect(JSON.stringify(sanitized)).not.toContain("raw-agent-session-key")
    expect(result.outputs?.agentConversation?.sessionKey).toBe("raw-agent-session-key")
  })
})
