import { describe, expect, it } from "vitest"

import { buildContextRecoveryHandoff, CONTEXT_RECOVERY_HANDOFF_MAX_BYTES } from "../context-recovery"

describe("buildContextRecoveryHandoff", () => {
  it("builds a bounded handoff without tool bodies, base64, absolute paths, or secrets", () => {
    const content = buildContextRecoveryHandoff({
      workspacePath: "/workspace/project",
      conversation: {
        id: "conversation-1",
        schemaVersion: 1,
        projectId: "project-1",
        sessionKey: "local",
        history: [
          { role: "assistant", content: "Earlier answer", timestamp: "2026-09-12T00:00:00.000Z" },
          {
            role: "user",
            content: "Inspect /Users/liyang/private.txt data:image/png;base64,QUJD",
            timestamp: "2026-09-12T00:01:00.000Z",
            metadata: { attachments: [{ kind: "image", name: "diagram.png" }] },
          },
          {
            role: "tool",
            content: `Bash\nAuthorization: Bearer secret-token\n${"x".repeat(40_000)}`,
            timestamp: "2026-09-12T00:02:00.000Z",
            metadata: { toolName: "Bash", status: "completed" },
          },
          {
            role: "system",
            content: "2 files changed",
            timestamp: "2026-09-12T00:03:00.000Z",
            metadata: {
              files: [
                { path: "/workspace/project/src/app.ts" },
                { path: "/outside/secret.txt" },
              ],
            },
          },
        ],
        active: true,
        createdAt: "2026-09-12T00:00:00.000Z",
        updatedAt: "2026-09-12T00:03:00.000Z",
      },
    })

    expect(Buffer.byteLength(content, "utf8")).toBeLessThanOrEqual(CONTEXT_RECOVERY_HANDOFF_MAX_BYTES)
    expect(content).toContain("Bash: completed")
    expect(content).toContain("src/app.ts")
    expect(content).toContain("diagram.png")
    expect(content).not.toContain("secret-token")
    expect(content).not.toContain("QUJD")
    expect(content).not.toContain("/Users/liyang")
    expect(content).not.toContain("/outside")
    expect(content).not.toContain("x".repeat(1_000))
  })
})
