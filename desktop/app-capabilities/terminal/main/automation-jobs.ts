import type { ControlledProcessRunner } from "../../../electron/runtime/process"

/** Only processes on this still-owned PTY are eligible; never walk all user processes. */
export function createAutomationJobTerminator(runner: Pick<ControlledProcessRunner, "run">) {
  return async ({ pid, tty }: { pid: number; tty: string }): Promise<void> => {
    if (!Number.isSafeInteger(pid) || pid <= 1 || !/^\/dev\/[a-zA-Z0-9/_-]+$/.test(tty)) throw new Error("invalid_owned_pty")
    for (let pass = 0; pass < 2; pass++) {
      const result = await runner.run({ actor: { kind: "system", id: "automation-terminal-cleanup" }, action: "shell.exec",
        command: "/bin/ps", args: ["-t", tty, "-o", "pid="], timeoutMs: 1_000, terminationGraceMs: 100,
        output: { stdout: "buffer", stderr: "buffer", maxBufferBytes: 64 * 1024 },
        metadata: { source: "terminal.automation-job-cleanup", rootPid: pid } })
      if (result.timedOut || result.error || result.signal || result.stdoutTruncated || result.stderrTruncated || result.stderr?.trim() || (result.exitCode !== 0 && result.exitCode !== 1)) throw new Error("pty_job_probe_failed")
      const values = (result.stdout ?? "").trim().split(/\s+/).filter(Boolean)
      if (values.some(value => !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 1)) throw new Error("pty_job_probe_failed")
      const pids = values.map(Number)
      if (result.exitCode === 1 && pids.length) throw new Error("pty_job_probe_failed")
      if (!pids.includes(pid)) {
        if (pids.length) throw new Error("pty_job_ownership_lost") // Never adopt a reused TTY.
        return
      }
      for (const child of pids) {
        if (child === pid) continue
        try { process.kill(child, "SIGKILL") }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error }
      }
    }
  }
}
