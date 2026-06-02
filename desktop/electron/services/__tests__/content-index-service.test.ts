import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it, vi } from "vitest"

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
})
