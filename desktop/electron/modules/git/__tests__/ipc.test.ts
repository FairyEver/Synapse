import { describe, expect, it, vi } from "vitest"
import type { IpcHandlerContext } from "../../../runtime/ipc/types"
import { gitIpcModule } from "../ipc"

function createContext(resolveMap: Record<string, unknown>): IpcHandlerContext {
  return {
    moduleId: "git",
    resolve: <T,>(key: string): T => {
      const service = resolveMap[key]
      if (!service) throw new Error(`Unexpected service id: ${key}`)
      return service as T
    },
  }
}

describe("gitIpcModule", () => {
  it("declares structured channels", () => {
    expect(gitIpcModule.id).toBe("git")
    expect(gitIpcModule.methods.listRepositories.channel).toBe("synapse:git:repositories:list")
    expect(gitIpcModule.methods.getSnapshot.channel).toBe("synapse:git:status:get-snapshot")
    expect(gitIpcModule.methods.commit.channel).toBe("synapse:git:commit:create")
  })

  it("rejects arbitrary git command payloads", () => {
    expect(gitIpcModule.methods.getSnapshot.request.safeParse({ repositoryId: "repo-1", args: ["status"] }).success).toBe(false)
  })

  it("lists repositories through the registry service", async () => {
    const registry = {
      list: vi.fn().mockResolvedValue([
        { id: "repo-1", name: "Docs", localPath: "/repo", addedAt: "now", lastOpenedAt: null },
      ]),
    }
    const result = await gitIpcModule.methods.listRepositories.handler(createContext({ "git.repository-registry": registry }), undefined)

    expect(result).toHaveLength(1)
  })
})
