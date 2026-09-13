import path from "node:path"
import { describe, expect, it } from "vitest"

import { buildContextRecoveryHandoff, CONTEXT_RECOVERY_HANDOFF_MAX_BYTES, safeContextHandoffText } from "../context-recovery"

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
    expect(content).toContain(path.join("src", "app.ts"))
    expect(content).toContain("diagram.png")
    expect(content).not.toContain("secret-token")
    expect(content).not.toContain("QUJD")
    expect(content).not.toContain("/Users/liyang")
    expect(content).not.toContain("/outside")
    expect(content).not.toContain("x".repeat(1_000))
  })
})


it.each([String.raw`\\server\share\private.txt`, String.raw`C:\Project Space\private.txt`, "C:/Project Space/private.txt"])("redacts Windows paths from manual recovery: %s", (file) => {
  expect(safeContextHandoffText(`Read "${file}"`)).not.toContain("private.txt")
})


it.each([
  { workspace: String.raw`D:\工作 空间`, inside: String.raw`D:\工作 空间\src\文件.txt`, outside: String.raw`C:\private\outside.txt` },
  { workspace: String.raw`\\server\share\工作`, inside: String.raw`\\server\share\工作\src\文件.txt`, outside: String.raw`\\other\share\private\outside.txt` },
])("only includes proven workspace-relative files for $workspace", ({ workspace, inside, outside }) => {
  const handoff = buildContextRecoveryHandoff({ workspacePath: workspace, conversation: {
    id: "c", schemaVersion: 1, projectId: "p", sessionKey: "local", active: true, createdAt: "now", updatedAt: "now",
    history: [{ role: "user", content: "Continue", timestamp: "now" }, { role: "system", content: "files", timestamp: "now",
      metadata: { files: [{ path: inside }, { path: outside }, { path: "D:drive-relative.txt" }, { path: String.raw`..\escape.txt` }] } }],
  } })
  expect(handoff).toContain(String.raw`src\文件.txt`)
  expect(handoff).not.toContain("outside.txt")
  expect(handoff).not.toContain("drive-relative.txt")
  expect(handoff).not.toContain("escape.txt")
})
