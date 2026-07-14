import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { SynapseContentMeta } from "../../../src/types/content"

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

function createMockChildProcess() {
  const child = new EventEmitter() as EventEmitter & {
    kill: ReturnType<typeof vi.fn>
    stderr: EventEmitter
    stdout: EventEmitter
  }
  child.kill = vi.fn()
  child.stderr = new EventEmitter()
  child.stdout = new EventEmitter()
  return child
}

describe("content-index-service git helpers", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    spawnMock.mockReset()
  })

  it("kills hung git text commands when they exceed the timeout", async () => {
    vi.useFakeTimers()
    const child = createMockChildProcess()
    spawnMock.mockReturnValue(child)

    const { _runGitTextForTests } = await import("../content-index-service")
    const result = _runGitTextForTests("/repo", ["rev-parse", "HEAD"], 25)
    const rejection = expect(result).rejects.toThrow("内容索引 Git 命令超时。")

    await vi.advanceTimersByTimeAsync(25)

    await rejection
    expect(child.kill).toHaveBeenCalledWith("SIGTERM")
  })

  it("commits repository cache writes when the callback succeeds", async () => {
    const exec = vi.fn()
    const { _runRepositoryCacheWriteTransactionForTests } = await import("../content-index-service")

    const result = await _runRepositoryCacheWriteTransactionForTests({ exec } as never, () => "ok")

    expect(result).toBe("ok")
    expect(exec.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN IMMEDIATE", "COMMIT"])
  })

  it("rolls back repository cache writes when the callback fails", async () => {
    const exec = vi.fn()
    const failure = new Error("write failed")
    const { _runRepositoryCacheWriteTransactionForTests } = await import("../content-index-service")

    await expect(_runRepositoryCacheWriteTransactionForTests({ exec } as never, async () => {
      throw failure
    })).rejects.toThrow(failure)

    expect(exec.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN IMMEDIATE", "ROLLBACK"])
  })

  it("preserves usage and env metadata while mapping content summaries to database rows", async () => {
    const {
      _fromDatabaseRowForTests,
      _toDatabaseRowForTests,
    } = await import("../content-index-service")
    const summary: SynapseContentMeta<"skill"> = {
      attachmentCount: 0,
      category: "General",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "user",
      createdByDisplayName: "User",
      deleted: false,
      description: "Description",
      icon: "file-text",
      iconBg: "default",
      hasEnv: true,
      id: "skill-1",
      latestHistoryDirname: "20260101000000Z__user__abc123",
      modifiedAt: "2026-01-02T00:00:00.000Z",
      modifiedBy: "user",
      modifiedByDisplayName: "User",
      title: "Skill",
      type: "skill",
      usage: "Use this skill when triaging content.",
    }

    const row = _toDatabaseRowForTests(summary, new Map())

    expect(row.usage).toBe("Use this skill when triaging content.")
    expect(row.hasEnv).toBe(1)
    expect(_fromDatabaseRowForTests({
      attachment_count: row.attachmentCount,
      category: row.category,
      created_at: row.createdAt,
      created_by: row.createdBy,
      created_by_name: row.createdByDisplayName,
      deleted: row.deleted,
      description: row.description,
      icon: row.icon,
      icon_bg: row.iconBg,
      icon_image: row.iconImage,
      icon_type: row.iconType,
      has_env: row.hasEnv,
      id: row.id,
      latest_history_dirname: row.latestHistoryDirname,
      modified_at: row.modifiedAt,
      modified_by: row.modifiedBy,
      modified_by_name: row.modifiedByDisplayName,
      name: row.name,
      title: row.title,
      type: row.type,
      usage: row.usage,
    })).toMatchObject({
      hasEnv: true,
      id: "skill-1",
      usage: "Use this skill when triaging content.",
    })
  })
})
