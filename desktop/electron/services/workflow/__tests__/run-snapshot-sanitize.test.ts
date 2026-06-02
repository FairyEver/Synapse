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

  it("sanitizes persisted node output, structured outputs, and errors", () => {
    const result: NodeRunResult = {
      nodeId: "http-1",
      status: "failed",
      input: { variables: {}, prompt: "call API" },
      output: "body includes Authorization: Bearer response-token and sk-live-secret",
      outputs: {
        status: 500,
        headers: {
          authorization: "Bearer response-token",
          "set-cookie": "session_token=abc123; Path=/",
          "x-api-key": "sk-live-secret",
        },
        body: {
          message: "token: abc123",
          nested: {
            cookie: "session=secret-cookie",
          },
        },
      },
      error: "Request failed with cookie=session-secret and /Users/liyang/private.txt",
    }

    const sanitized = sanitizeNodeResultsForSnapshot({ "http-1": result })
    const raw = JSON.stringify(sanitized)

    expect(sanitized["http-1"]?.output).not.toContain("response-token")
    expect(sanitized["http-1"]?.outputs?.headers).toEqual({
      authorization: "[redacted]",
      "set-cookie": "[redacted]",
      "x-api-key": "[redacted]",
    })
    expect(sanitized["http-1"]?.outputs?.body).toEqual({
      message: "token=[redacted]",
      nested: {
        cookie: "[redacted]",
      },
    })
    expect(sanitized["http-1"]?.error).toContain("[path]")
    expect(raw).not.toContain("response-token")
    expect(raw).not.toContain("sk-live-secret")
    expect(raw).not.toContain("abc123")
    expect(raw).not.toContain("secret-cookie")
    expect(raw).not.toContain("/Users/liyang/private.txt")
  })
})
