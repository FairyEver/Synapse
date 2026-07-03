import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  agentArtifactUrlForRelativePath,
  agentArtifactUrlForStoragePath,
  resolveAgentArtifactUrlPath,
} from "../artifact-url"

describe("agent artifact URLs", () => {
  it("builds stable custom URLs from artifact relative paths", () => {
    expect(agentArtifactUrlForRelativePath("project 1/conversation 中文/artifact 1.png"))
      .toBe("synapse-agent-artifact://local/project%201/conversation%20%E4%B8%AD%E6%96%87/artifact%201.png")
  })

  it("resolves custom URLs only inside the artifact root", () => {
    const root = path.resolve("/tmp/synapse-agent-artifacts")
    const url = "synapse-agent-artifact://local/project_1/conversation_1/artifact_1.png"

    expect(resolveAgentArtifactUrlPath(root, url))
      .toBe(path.join(root, "project_1", "conversation_1", "artifact_1.png"))
    expect(resolveAgentArtifactUrlPath(root, "synapse-agent-artifact://local/project_1/../secret.png"))
      .toBeUndefined()
    expect(resolveAgentArtifactUrlPath(root, "file:///tmp/synapse-agent-artifacts/project_1/image.png"))
      .toBeUndefined()
  })

  it("converts storage paths under the artifact root to custom URLs", () => {
    const root = path.resolve("/tmp/synapse-agent-artifacts")
    const storagePath = path.join(root, "project_1", "conversation_1", "artifact_1.png")

    expect(agentArtifactUrlForStoragePath(root, storagePath))
      .toBe("synapse-agent-artifact://local/project_1/conversation_1/artifact_1.png")
    expect(agentArtifactUrlForStoragePath(root, "/tmp/outside.png")).toBeUndefined()
  })
})
