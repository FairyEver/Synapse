import { afterEach, describe, expect, it, vi } from "vitest"
import { createAutomationJobTerminator } from "../automation-jobs"

afterEach(() => vi.restoreAllMocks())
const ok = { exitCode: 0, signal: null, timedOut: false, durationMs: 1 }
describe("owned interactive PTY job cleanup", () => {
  it("uses guarded bounded ps and kills only children on the exact still-owned tty", async () => {
    const run = vi.fn().mockResolvedValueOnce({ ...ok, stdout: "123\n456\n" }).mockResolvedValueOnce({ ...ok, stdout: "123\n" })
    const kill = vi.spyOn(process, "kill").mockReturnValue(true)
    await createAutomationJobTerminator({ run })({ pid: 123, tty: "/dev/ttys999" })
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ action: "shell.exec", args: ["-t", "/dev/ttys999", "-o", "pid="], timeoutMs: 1000 }))
    expect(kill.mock.calls).toEqual([[456, "SIGKILL"]])
  })
  it("does not adopt a reused tty and does not mistake probe failure for a confirmed stop", async () => {
    const kill = vi.spyOn(process, "kill").mockReturnValue(true)
    for (const result of [{ ...ok, stdout: "456" }, { ...ok, timedOut: true, stdout: "123" }, { ...ok, stdoutTruncated: true, stdout: "123" }, { ...ok, exitCode: 2 }, { ...ok, exitCode: 1, stderr: "permission denied" }, { ...ok, stdout: "invalid" }]) {
      await expect(createAutomationJobTerminator({ run: vi.fn().mockResolvedValue(result) })({ pid: 123, tty: "/dev/ttys999" })).rejects.toThrow()
    }
    expect(kill).not.toHaveBeenCalled()
    await expect(createAutomationJobTerminator({ run: vi.fn().mockResolvedValue({ ...ok, exitCode: 1, stdout: "" }) })({ pid: 123, tty: "/dev/ttys999" })).resolves.toBeUndefined()
  })
})
