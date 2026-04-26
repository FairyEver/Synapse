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
})
