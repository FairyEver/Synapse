import path from "node:path"
import { describe, expect, it } from "vitest"
import type { SynapseProjectConfig } from "../../../../src/types/config"
import {
  isManagedKnowledgeBaseProject,
  knowledgeBaseVirtualPath,
  resolveManagedKnowledgeBasePath,
} from "../managed-path"

describe("managed knowledge base paths", () => {
  function managedProject(runtimeId: string): SynapseProjectConfig {
    return {
      id: runtimeId,
      name: "Knowledge",
      path: `synapse-kb://${runtimeId}`,
      capabilities: {
        knowledgeBase: {
          enabled: true,
          schemaVersion: 1,
          templateVersion: "2026-05-24",
          managed: true,
          runtimeId,
        },
      },
    }
  }

  it("builds a virtual public path", () => {
    expect(knowledgeBaseVirtualPath("kb-1")).toBe("synapse-kb://kb-1")
  })

  it("resolves a managed project to userData-backed runtime path", () => {
    const project = managedProject("kb-1")

    expect(resolveManagedKnowledgeBasePath(project, "/UserData")).toBe(path.join("/UserData", "knowledge-bases", "kb-1"))
  })

  it("resolves a managed project to custom storage root runtime path", () => {
    const project = managedProject("kb-1")

    expect(resolveManagedKnowledgeBasePath(project, {
      userDataPath: "/UserData",
      storage: { mode: "custom", rootPath: "/Volumes/Data/SynapseData" },
    })).toBe(path.join(path.resolve("/Volumes/Data/SynapseData"), "knowledge-bases", "kb-1"))
  })

  it("does not treat legacy knowledge bases as managed", () => {
    const project: SynapseProjectConfig = {
      id: "legacy",
      name: "Legacy",
      path: "/Users/example/kb",
      capabilities: {
        knowledgeBase: {
          enabled: true,
          schemaVersion: 1,
          templateVersion: "2026-05-21",
        },
      },
    }

    expect(isManagedKnowledgeBaseProject(project)).toBe(false)
  })
})
