import type { SynapseGitCommitDetail, SynapseGitCommitSummary, SynapseGitFileChange, SynapseGitRepository } from "../../../src/types/git"
import type { GitClientCommandRunner } from "./git-command-runner"

const FIELD = "%x1f"
const RECORD = "%x1e"
const PRETTY = `%H${FIELD}%h${FIELD}%s${FIELD}%an${FIELD}%ae${FIELD}%cI${RECORD}`

function parseCommitRecord(record: string): SynapseGitCommitSummary | null {
  const [hash, shortHash, subject, authorName, authorEmail, committedAt] = record.split("\x1f")
  if (!hash || !shortHash || !subject || !authorName || !authorEmail || !committedAt) return null
  return { hash, shortHash, subject, authorName, authorEmail, committedAt }
}

function statusFromNameStatus(code: string): SynapseGitFileChange["status"] {
  if (code.startsWith("A")) return "added"
  if (code.startsWith("M")) return "modified"
  if (code.startsWith("D")) return "deleted"
  if (code.startsWith("R")) return "renamed"
  return "unknown"
}

function parseNameStatus(lines: readonly string[]): SynapseGitFileChange[] {
  return lines.filter(Boolean).map((line) => {
    const parts = line.split("\t")
    const code = parts[0] ?? ""
    const path = parts[1] ?? ""
    const originalPath = code.startsWith("R") ? path : null
    const nextPath = code.startsWith("R") ? (parts[2] ?? path) : path
    return {
      path: nextPath,
      originalPath,
      status: statusFromNameStatus(code),
      staged: false,
      conflicted: false,
    }
  })
}

export function createGitHistoryService(deps: { readonly commandRunner: Pick<GitClientCommandRunner, "run"> }) {
  return {
    async list(
      repository: SynapseGitRepository,
      input: { readonly limit: number; readonly offset: number },
    ): Promise<SynapseGitCommitSummary[]> {
      const result = await deps.commandRunner.run({
        cwd: repository.localPath,
        args: [
          "log",
          `--pretty=format:${PRETTY}`,
          "--date=iso-strict",
          "--max-count",
          String(input.limit),
          "--skip",
          String(input.offset),
        ],
      })
      return result.stdout
        .split("\x1e")
        .map((record) => parseCommitRecord(record.trim()))
        .filter((item): item is SynapseGitCommitSummary => Boolean(item))
    },

    async getCommit(repository: SynapseGitRepository, hash: string): Promise<SynapseGitCommitDetail> {
      const summaryResult = await deps.commandRunner.run({
        cwd: repository.localPath,
        args: ["show", "--name-status", `--pretty=format:${PRETTY}`, "--date=iso-strict", "--no-renames", hash],
      })
      const [firstLine = "", ...fileLines] = summaryResult.stdout.split(/\r?\n/)
      const summary = parseCommitRecord(firstLine.replace(/\x1e$/, ""))
      if (!summary) throw new Error("找不到提交记录。")
      const diffResult = await deps.commandRunner.run({ cwd: repository.localPath, args: ["show", "--format=", "--patch", hash] })
      return {
        ...summary,
        files: parseNameStatus(fileLines),
        diff: diffResult.stdout,
      }
    },
  }
}

export type GitHistoryService = ReturnType<typeof createGitHistoryService>
