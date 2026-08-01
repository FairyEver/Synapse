import { EventEmitter } from "node:events"
import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PassThrough } from "node:stream"
import type { ChildProcessWithoutNullStreams } from "node:child_process"

import { describe, expect, it, vi } from "vitest"

import { InMemoryAuditSink, createPermissionGuard } from "../../security"
import {
  ControlledProcessPermissionError,
  type ControlledProcessRunRequest,
  createControlledProcessRunner,
  computePath,
  splitPath,
  dedupePath,
} from "../controlled-runner"

function createChildThatIgnoresSigterm(): {
  readonly child: ChildProcessWithoutNullStreams
  readonly kill: ReturnType<typeof vi.fn>
} {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const child = new EventEmitter() as ChildProcessWithoutNullStreams
  const kill = vi.fn((signal?: NodeJS.Signals) => {
    if (signal === "SIGKILL") {
      queueMicrotask(() => {
        stdout.end()
        stderr.end()
        child.emit("close", null, "SIGKILL")
      })
    }
    return true
  })
  Object.assign(child, {
    stdout,
    stderr,
    stdin: new PassThrough(),
    kill,
  })
  return { child, kill }
}

async function fileExists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true, () => false)
}

describe("ControlledProcessRunner (Phase 0.7)", () => {
  it.skipIf(process.platform === "win32")("checks permission before resolving login shell PATH", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-runner-"))
    const markerPath = path.join(tempDir, "shell-was-run")
    const shellPath = path.join(tempDir, "login-shell")
    const previousShell = process.env.SHELL
    let markerAtPermissionCheck = false

    try {
      await writeFile(
        shellPath,
        [
          "#!/bin/sh",
          `printf hit > ${JSON.stringify(markerPath)}`,
          "printf '__SYNAPSE_PATH_BEGIN__/tmp__SYNAPSE_PATH_END__\\n'",
        ].join("\n"),
      )
      await chmod(shellPath, 0o755)
      process.env.SHELL = shellPath

      const permissionGuard = {
        registerPolicy: () => () => {},
        check: async () => {
          markerAtPermissionCheck = await fileExists(markerPath)
          return { allowed: false, reason: "denied before launch" } as const
        },
      }
      const auditSink = new InMemoryAuditSink()
      const runner = createControlledProcessRunner({ permissionGuard, auditSink })

      const request: ControlledProcessRunRequest = {
        actor: { kind: "user" },
        action: "shell.exec",
        command: process.execPath,
      }
      await expect(runner.run(request)).rejects.toBeInstanceOf(ControlledProcessPermissionError)

      expect(markerAtPermissionCheck).toBe(false)
      await expect(fileExists(markerPath)).resolves.toBe(false)
    } finally {
      if (previousShell === undefined) {
        delete process.env.SHELL
      } else {
        process.env.SHELL = previousShell
      }
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("runs an allowed command and records an allowed audit event", async () => {
    const guard = createPermissionGuard()
    const auditSink = new InMemoryAuditSink()
    const runner = createControlledProcessRunner({ permissionGuard: guard, auditSink })

    const result = await runner.run({
      actor: { kind: "user" },
      action: "agent.spawn",
      command: process.execPath,
      args: ["-e", "process.stdout.write(JSON.stringify({ ok: true }) + '\\n')"],
      output: { stdout: "json-lines" },
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("\"ok\":true")
    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        action: "agent.spawn",
        outcome: "allowed",
        resource: process.execPath,
      }),
    ])
  })

  it("resolves bare Windows commands to cmd shims before spawning", async () => {
    const guard = createPermissionGuard()
    const auditSink = new InMemoryAuditSink()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const child = new EventEmitter() as ChildProcessWithoutNullStreams
    Object.assign(child, {
      stdout,
      stderr,
      stdin: new PassThrough(),
      kill: vi.fn(),
    })
    const spawnImpl = vi.fn(() => {
      queueMicrotask(() => {
        stdout.end()
        stderr.end()
        child.emit("close", 0, null)
      })
      return child
    })
    const runner = createControlledProcessRunner({
      permissionGuard: guard,
      auditSink,
      spawnImpl,
      platform: "win32",
      fileExists: (candidate) => candidate === "C:\\Tools\\codex.cmd",
    })

    await expect(runner.run({
      actor: { kind: "user" },
      action: "shell.exec",
      command: "codex",
      args: ["exec", "--json"],
      env: {
        PATH: "C:\\Tools",
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
      },
      pathStrategy: "replace",
    })).resolves.toMatchObject({ exitCode: 0 })

    expect(spawnImpl).toHaveBeenCalledWith(
      "C:\\Windows\\System32\\cmd.exe",
      ["/d", "/s", "/c", "C:\\Tools\\codex.cmd exec --json"],
      expect.objectContaining({
        shell: false,
        windowsHide: true,
      }),
    )
    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        action: "shell.exec",
        outcome: "allowed",
        resource: "codex",
      }),
    ])
  })

  it("escapes quotes and cmd metacharacters for Windows cmd shims", async () => {
    const guard = createPermissionGuard()
    const auditSink = new InMemoryAuditSink()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const child = new EventEmitter() as ChildProcessWithoutNullStreams
    Object.assign(child, {
      stdout,
      stderr,
      stdin: new PassThrough(),
      kill: vi.fn(),
    })
    const spawnImpl = vi.fn(() => {
      queueMicrotask(() => {
        stdout.end()
        stderr.end()
        child.emit("close", 0, null)
      })
      return child
    })
    const runner = createControlledProcessRunner({
      permissionGuard: guard,
      auditSink,
      spawnImpl,
      platform: "win32",
      fileExists: (candidate) => candidate === "C:\\Tools\\claude.cmd",
    })

    await expect(runner.run({
      actor: { kind: "user" },
      action: "shell.exec",
      command: "claude",
      args: ["-p", "Use {\"mode\":\"fast\"} & keep \"quotes\""],
      env: {
        PATH: "C:\\Tools",
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
      },
      pathStrategy: "replace",
    })).resolves.toMatchObject({ exitCode: 0 })

    expect(spawnImpl).toHaveBeenCalledWith(
      "C:\\Windows\\System32\\cmd.exe",
      [
        "/d",
        "/s",
        "/c",
        "C:\\Tools\\claude.cmd -p \"Use {\"\"mode\"\":\"\"fast\"\"} ^& keep \"\"quotes\"\"\"",
      ],
      expect.objectContaining({
        shell: false,
        windowsHide: true,
      }),
    )
  })

  it("denies non-user actors by default, records audit, and does not spawn", async () => {
    const guard = createPermissionGuard()
    const auditSink = new InMemoryAuditSink()
    const spawnImpl = vi.fn()
    const runner = createControlledProcessRunner({
      permissionGuard: guard,
      auditSink,
      spawnImpl,
    })

    await expect(
      runner.run({
        actor: { kind: "agent", id: "agent-1" },
        action: "shell.exec",
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
      }),
    ).rejects.toBeInstanceOf(ControlledProcessPermissionError)

    expect(spawnImpl).not.toHaveBeenCalled()
    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        action: "shell.exec",
        actor: { kind: "agent", id: "agent-1" },
        outcome: "denied",
      }),
    ])
  })

  it("records failed audit for non-zero exits", async () => {
    const guard = createPermissionGuard()
    const auditSink = new InMemoryAuditSink()
    const runner = createControlledProcessRunner({ permissionGuard: guard, auditSink })

    const result = await runner.run({
      actor: { kind: "user" },
      action: "shell.exec",
      command: process.execPath,
      args: ["-e", "process.stderr.write('bad'); process.exit(7)"],
    })

    expect(result.exitCode).toBe(7)
    expect(result.stderr).toBe("bad")
    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        action: "shell.exec",
        outcome: "failed",
      }),
    ])
  })

  it("escalates timed out runs to SIGKILL when SIGTERM is ignored", async () => {
    vi.useFakeTimers()
    try {
      const guard = createPermissionGuard()
      const auditSink = new InMemoryAuditSink()
      const { child, kill } = createChildThatIgnoresSigterm()
      const runner = createControlledProcessRunner({
        permissionGuard: guard,
        auditSink,
        spawnImpl: () => child,
      })

      const resultPromise = runner.run({
        actor: { kind: "user" },
        action: "shell.exec",
        command: process.execPath,
        timeoutMs: 10,
      })

      await vi.advanceTimersByTimeAsync(10)
      expect(kill).toHaveBeenCalledWith("SIGTERM")

      await vi.advanceTimersByTimeAsync(5_000)
      expect(kill).toHaveBeenCalledWith("SIGKILL")
      await expect(resultPromise).resolves.toMatchObject({
        signal: "SIGKILL",
        timedOut: true,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it.skipIf(process.platform === "win32")("terminates the process group on abort", async () => {
    const guard = createPermissionGuard()
    const auditSink = new InMemoryAuditSink()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const child = new EventEmitter() as ChildProcessWithoutNullStreams
    const kill = vi.fn()
    Object.assign(child, {
      pid: 12345,
      stdout,
      stderr,
      stdin: new PassThrough(),
      kill,
    })
    const spawnImpl = vi.fn(() => child)
    const processKill = vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
      if (pid === -12345 && signal === "SIGTERM") {
        queueMicrotask(() => {
          stdout.end()
          stderr.end()
          child.emit("close", null, "SIGTERM")
        })
      }
      return true
    }) as typeof process.kill)

    try {
      const runner = createControlledProcessRunner({ permissionGuard: guard, auditSink, spawnImpl })
      const abortController = new AbortController()
      const resultPromise = runner.run({
        actor: { kind: "user" },
        action: "shell.exec",
        command: process.execPath,
        abortSignal: abortController.signal,
      })

      await Promise.resolve()
      abortController.abort()

      await expect(resultPromise).resolves.toMatchObject({
        signal: "SIGTERM",
      })
      expect(processKill).toHaveBeenCalledWith(-12345, "SIGTERM")
      expect(kill).not.toHaveBeenCalled()
      expect(spawnImpl).toHaveBeenCalledWith(
        process.execPath,
        [],
        expect.objectContaining({
          detached: true,
        }),
      )
    } finally {
      processKill.mockRestore()
    }
  })

  it("passes only allowlisted env keys to the spawned process", async () => {
    const guard = createPermissionGuard()
    const auditSink = new InMemoryAuditSink()
    const runner = createControlledProcessRunner({ permissionGuard: guard, auditSink })

    const result = await runner.run({
      actor: { kind: "user" },
      action: "agent.spawn",
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write(JSON.stringify({ allowed: process.env.CC_PROJECT, blocked: process.env.SECRET_VALUE ?? null }) + '\\n')",
      ],
      env: {
        CC_PROJECT: "proj-1",
        SECRET_VALUE: "hidden",
      },
      envAllowlist: ["CC_PROJECT"],
      output: { stdout: "json-lines" },
    })

    expect(JSON.parse(result.stdout ?? "{}")).toEqual({
      allowed: "proj-1",
      blocked: null,
    })
  })

  it("wraps Windows batch shims and preserves profile env", async () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    })

    try {
      const guard = createPermissionGuard()
      const auditSink = new InMemoryAuditSink()
      const spawnImpl = vi.fn(() => {
        const stdout = new PassThrough()
        const stderr = new PassThrough()
        const child = new EventEmitter() as ChildProcessWithoutNullStreams
        Object.assign(child, {
          stdout,
          stderr,
          stdin: new PassThrough(),
          kill: vi.fn(),
        })
        queueMicrotask(() => {
          stdout.end()
          stderr.end()
          child.emit("close", 0, null)
        })
        return child
      })
      const runner = createControlledProcessRunner({ permissionGuard: guard, auditSink, spawnImpl })

      await runner.run({
        actor: { kind: "user" },
        action: "agent.spawn",
        command: "C:\\Users\\Ada Lovelace\\AppData\\Roaming\\npm\\codex.cmd",
        args: ["exec", "-"],
        env: {
          APPDATA: "C:\\Users\\Ada\\AppData\\Roaming",
          ComSpec: "C:\\Windows\\System32\\cmd.exe",
          HOMEDRIVE: "C:",
          HOMEPATH: "\\Users\\Ada",
          LOCALAPPDATA: "C:\\Users\\Ada\\AppData\\Local",
          Path: "C:\\Users\\Ada\\AppData\\Roaming\\npm;C:\\Windows\\System32",
          USERPROFILE: "C:\\Users\\Ada",
        },
      })

      expect(spawnImpl).toHaveBeenCalledWith(
        "C:\\Windows\\System32\\cmd.exe",
        [
          "/d",
          "/s",
          "/c",
          "\"C:\\Users\\Ada Lovelace\\AppData\\Roaming\\npm\\codex.cmd\" exec -",
        ],
        expect.objectContaining({
          env: expect.objectContaining({
            APPDATA: "C:\\Users\\Ada\\AppData\\Roaming",
            HOMEDRIVE: "C:",
            HOMEPATH: "\\Users\\Ada",
            LOCALAPPDATA: "C:\\Users\\Ada\\AppData\\Local",
            PATH: expect.stringContaining("C:\\Users\\Ada\\AppData\\Roaming\\npm;C:\\Windows\\System32"),
            USERPROFILE: "C:\\Users\\Ada",
          }),
          shell: false,
        }),
      )
    } finally {
      if (platformDescriptor) {
        Object.defineProperty(process, "platform", platformDescriptor)
      }
    }
  })

  it.skipIf(process.platform === "win32")("wraps run_as_user launches with sudo and filters isolation env", async () => {
    const guard = createPermissionGuard()
    const auditSink = new InMemoryAuditSink()
    const spawnImpl = vi.fn(() => {
      const stdout = new PassThrough()
      const stderr = new PassThrough()
      const child = new EventEmitter() as ChildProcessWithoutNullStreams
      Object.assign(child, {
        stdout,
        stderr,
        stdin: new PassThrough(),
        kill: vi.fn(),
      })
      queueMicrotask(() => {
        stdout.end()
        stderr.end()
        child.emit("close", 0, null)
      })
      return child
    })
    const runner = createControlledProcessRunner({ permissionGuard: guard, auditSink, spawnImpl })

    await runner.run({
      actor: { kind: "user" },
      action: "agent.spawn",
      command: "codex",
      args: ["exec", "-"],
      env: {
        CC_PROJECT: "project-1",
        LANG: "en_US.UTF-8",
        SECRET_VALUE: "hidden",
      },
      envAllowlist: ["CC_PROJECT", "LANG", "SECRET_VALUE"],
      isolation: {
        kind: "run_as_user",
        user: "synapse-worker",
        envAllowlist: ["CC_PROJECT", "LANG"],
      },
    })

    expect(spawnImpl).toHaveBeenCalledWith(
      "sudo",
      [
        "-n",
        "-iu",
        "synapse-worker",
        "--preserve-env=CC_PROJECT,LANG",
        "--",
        "codex",
        "exec",
        "-",
      ],
      expect.objectContaining({
        env: {
          CC_PROJECT: "project-1",
          LANG: "en_US.UTF-8",
        },
      }),
    )
  })

  it("writes stdin and streams complete stdout lines", async () => {
    const guard = createPermissionGuard()
    const auditSink = new InMemoryAuditSink()
    const runner = createControlledProcessRunner({ permissionGuard: guard, auditSink })
    const seen: string[] = []

    const result = await runner.run({
      actor: { kind: "user" },
      action: "agent.spawn",
      command: process.execPath,
      args: [
        "-e",
        [
          "let input = '';",
          "process.stdin.on('data', chunk => { input += chunk; });",
          "process.stdin.on('end', () => {",
          "  for (const line of input.split(/\\n/)) {",
          "    process.stdout.write(JSON.stringify({ line }) + '\\n');",
          "  }",
          "});",
        ].join(" "),
      ],
      stdin: "first line\nsecond line",
      output: { stdout: "json-lines" },
      onStdoutLine: (line) => seen.push(line),
    })

    expect(result.exitCode).toBe(0)
    expect(seen.map((line) => JSON.parse(line))).toEqual([
      { line: "first line" },
      { line: "second line" },
    ])
  })

  it("starts a controlled long-running session with stdin writes and audit", async () => {
    const guard = createPermissionGuard()
    const auditSink = new InMemoryAuditSink()
    const runner = createControlledProcessRunner({ permissionGuard: guard, auditSink })
    const seen: string[] = []

    const session = await runner.start({
      actor: { kind: "user" },
      action: "agent.spawn",
      command: process.execPath,
      args: [
        "-e",
        [
          "const readline = require('node:readline');",
          "const rl = readline.createInterface({ input: process.stdin });",
          "rl.on('line', line => {",
          "  process.stdout.write(JSON.stringify({ line }) + '\\n');",
          "  if (line === 'stop') process.exit(0);",
          "});",
        ].join(" "),
      ],
      output: { stdout: "json-lines" },
      onStdoutLine: (line) => seen.push(line),
    })

    await session.writeStdin("hello\n")
    await session.writeStdin("stop\n")
    const result = await session.wait()

    expect(result.exitCode).toBe(0)
    expect(seen.map((line) => JSON.parse(line))).toEqual([
      { line: "hello" },
      { line: "stop" },
    ])
    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        action: "agent.spawn",
        outcome: "allowed",
        metadata: expect.objectContaining({ longRunning: true }),
      }),
    ])
  })

  it("escalates timed out sessions to SIGKILL when SIGTERM is ignored", async () => {
    vi.useFakeTimers()
    try {
      const guard = createPermissionGuard()
      const auditSink = new InMemoryAuditSink()
      const { child, kill } = createChildThatIgnoresSigterm()
      const runner = createControlledProcessRunner({
        permissionGuard: guard,
        auditSink,
        spawnImpl: () => child,
      })

      const session = await runner.start({
        actor: { kind: "user" },
        action: "shell.exec",
        command: process.execPath,
        timeoutMs: 10,
      })

      await vi.advanceTimersByTimeAsync(10)
      expect(kill).toHaveBeenCalledWith("SIGTERM")

      await vi.advanceTimersByTimeAsync(5_000)
      expect(kill).toHaveBeenCalledWith("SIGKILL")
      await expect(session.wait()).resolves.toMatchObject({
        signal: "SIGKILL",
        timedOut: true,
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("PATH merge helpers", () => {
  describe("splitPath", () => {
    it("splits POSIX paths on colon", () => {
      expect(splitPath("/usr/bin:/usr/local/bin", ":")).toEqual(["/usr/bin", "/usr/local/bin"])
    })

    it("filters empty segments", () => {
      expect(splitPath("/usr/bin::/usr/local/bin:", ":")).toEqual(["/usr/bin", "/usr/local/bin"])
    })

    it("splits Windows paths on semicolon", () => {
      expect(splitPath("C:\\Windows;C:\\Users\\bin", ";")).toEqual(["C:\\Windows", "C:\\Users\\bin"])
    })
  })

  describe("dedupePath", () => {
    it("deduplicates case-sensitively for POSIX", () => {
      expect(dedupePath(["/usr/bin", "/usr/local/bin", "/usr/bin"], false)).toEqual([
        "/usr/bin",
        "/usr/local/bin",
      ])
    })

    it("deduplicates case-insensitively for Windows", () => {
      expect(dedupePath(["C:\\Windows", "c:\\windows", "C:\\Users"], true)).toEqual([
        "C:\\Windows",
        "C:\\Users",
      ])
    })
  })

  describe("computePath", () => {
    it("merge: user paths first, shell paths appended, deduped", () => {
      const result = computePath(
        "merge",
        "/custom/bin:/usr/bin",
        "/usr/bin:/usr/local/bin:/opt/homebrew/bin",
        "/fallback",
        ":",
        false,
      )
      expect(result).toBe("/custom/bin:/usr/bin:/usr/local/bin:/opt/homebrew/bin")
    })

    it("merge: no user PATH uses shell PATH only", () => {
      const result = computePath(
        "merge",
        undefined,
        "/usr/bin:/usr/local/bin",
        "/fallback",
        ":",
        false,
      )
      expect(result).toBe("/usr/bin:/usr/local/bin")
    })

    it("merge: no shell PATH falls back", () => {
      const result = computePath(
        "merge",
        "/custom/bin",
        null,
        "/usr/bin:/usr/local/bin",
        ":",
        false,
      )
      expect(result).toBe("/custom/bin:/usr/bin:/usr/local/bin")
    })

    it("replace: uses user PATH verbatim", () => {
      const result = computePath(
        "replace",
        "/custom/bin",
        "/usr/bin:/usr/local/bin",
        "/fallback",
        ":",
        false,
      )
      expect(result).toBe("/custom/bin")
    })

    it("replace: no user PATH falls back to shell PATH", () => {
      const result = computePath(
        "replace",
        undefined,
        "/usr/bin:/usr/local/bin",
        "/fallback",
        ":",
        false,
      )
      expect(result).toBe("/usr/bin:/usr/local/bin")
    })

    it("replace with Windows semicolons", () => {
      const result = computePath(
        "replace",
        "C:\\Custom;C:\\Tools",
        "C:\\Windows;C:\\System32",
        "fallback",
        ";",
        true,
      )
      expect(result).toBe("C:\\Custom;C:\\Tools")
    })

    it("merge with Windows semicolons and case-insensitive dedup", () => {
      const result = computePath(
        "merge",
        "C:\\Custom;C:\\Windows",
        "c:\\windows;C:\\System32",
        "fallback",
        ";",
        true,
      )
      expect(result).toBe("C:\\Custom;C:\\Windows;C:\\System32")
    })
  })
})

describe("diagnostics", () => {
  it("populates diagnostics on successful run", async () => {
    const guard = createPermissionGuard()
    const auditSink = new InMemoryAuditSink()
    const runner = createControlledProcessRunner({ permissionGuard: guard, auditSink })

    const result = await runner.run({
      actor: { kind: "user" },
      action: "shell.exec",
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
    })

    expect(result.exitCode).toBe(0)
    expect(result.diagnostics).toBeDefined()
    expect(result.diagnostics!.envKeys).toEqual(expect.arrayContaining(["PATH"]))
    expect(result.diagnostics!.pathEntries.length).toBeGreaterThan(0)
    expect(result.diagnostics!.shell).toBe(process.execPath)
    expect(result.diagnostics!.args).toEqual(["-e", "process.exit(0)"])
  })

  it("populates diagnostics on failed run", async () => {
    const guard = createPermissionGuard()
    const auditSink = new InMemoryAuditSink()
    const runner = createControlledProcessRunner({ permissionGuard: guard, auditSink })

    const result = await runner.run({
      actor: { kind: "user" },
      action: "shell.exec",
      command: process.execPath,
      args: ["-e", "process.exit(1)"],
    })

    expect(result.exitCode).toBe(1)
    expect(result.diagnostics).toBeDefined()
    expect(result.diagnostics!.envKeys).toEqual(expect.arrayContaining(["PATH"]))
  })
})

describe("bounded output", () => {
  it("truncates buffered output when requested", async () => {
    const guard = createPermissionGuard()
    const auditSink = new InMemoryAuditSink()
    const runner = createControlledProcessRunner({ permissionGuard: guard, auditSink })

    const result = await runner.run({
      actor: { kind: "user" },
      action: "shell.exec",
      command: process.execPath,
      args: ["-e", "process.stdout.write('abcdefghij')"],
      output: { stdout: "buffer", maxBufferBytes: 4, overflow: "truncate" },
    })

    expect(result.stdout).toBe("abcd")
    expect(result.stdoutTruncated).toBe(true)
    expect(result.exitCode).toBe(0)
  })
})
