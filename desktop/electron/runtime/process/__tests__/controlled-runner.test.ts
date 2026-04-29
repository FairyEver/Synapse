import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import type { ChildProcessWithoutNullStreams } from "node:child_process"

import { describe, expect, it, vi } from "vitest"

import { InMemoryAuditSink, createPermissionGuard } from "../../security"
import {
  ControlledProcessPermissionError,
  createControlledProcessRunner,
} from "../controlled-runner"

describe("ControlledProcessRunner (Phase 0.7)", () => {
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
    const previousEnv = {
      APPDATA: process.env.APPDATA,
      ComSpec: process.env.ComSpec,
      HOMEDRIVE: process.env.HOMEDRIVE,
      HOMEPATH: process.env.HOMEPATH,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      USERPROFILE: process.env.USERPROFILE,
    }
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    })
    process.env.APPDATA = "C:\\Users\\Ada\\AppData\\Roaming"
    process.env.ComSpec = "C:\\Windows\\System32\\cmd.exe"
    process.env.HOMEDRIVE = "C:"
    process.env.HOMEPATH = "\\Users\\Ada"
    process.env.LOCALAPPDATA = "C:\\Users\\Ada\\AppData\\Local"
    process.env.USERPROFILE = "C:\\Users\\Ada"

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
            USERPROFILE: "C:\\Users\\Ada",
          }),
          shell: false,
        }),
      )
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
      if (platformDescriptor) {
        Object.defineProperty(process, "platform", platformDescriptor)
      }
    }
  })

  it("wraps run_as_user launches with sudo and filters isolation env", async () => {
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
})
