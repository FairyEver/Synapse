import path from "node:path"
import type { SynapseGitRemoteKind, SynapseGitRepository } from "../../../src/types/git"
import type { GitClientCommandRunner } from "./git-command-runner"

type CloneInput = {
  readonly remoteUrl: string
  readonly targetPath: string
  readonly name: string
}

type CloneResult = {
  readonly repository: SynapseGitRepository
  readonly remoteKind: SynapseGitRemoteKind
}

type CloneDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly registry: {
    addLocal(input: { readonly name: string; readonly localPath: string }): Promise<SynapseGitRepository>
  }
  readonly pathExists: (filePath: string) => Promise<boolean>
}

export function detectRemoteKind(remoteUrl: string): SynapseGitRemoteKind {
  if (/^https:\/\//i.test(remoteUrl)) return "https"
  if (/^(ssh:\/\/|[^@\s]+@[^:\s]+:.+)/i.test(remoteUrl)) return "ssh"
  return "unknown"
}

export function createGitCloneService(deps: CloneDeps) {
  return {
    async clone(input: CloneInput): Promise<CloneResult> {
      const remoteUrl = input.remoteUrl.trim()
      const targetPath = path.resolve(input.targetPath)
      if (!remoteUrl) throw new Error("请输入仓库地址。")
      if (!targetPath) throw new Error("请选择保存位置。")
      if (await deps.pathExists(targetPath)) {
        throw new Error("目标目录已存在。请选择空目录。")
      }

      await deps.commandRunner.run({
        cwd: path.dirname(targetPath),
        args: ["clone", "--progress", remoteUrl, targetPath],
        timeoutMs: 300_000,
      })
      const repository = await deps.registry.addLocal({ name: input.name, localPath: targetPath })
      return { repository, remoteKind: detectRemoteKind(remoteUrl) }
    },
  }
}

export type GitCloneService = ReturnType<typeof createGitCloneService>
