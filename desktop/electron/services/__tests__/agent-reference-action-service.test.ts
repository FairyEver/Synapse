import type { Stats } from "node:fs"
import { mkdtemp, mkdir, realpath, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AGENT_REFERENCE_MAX_CODE_POINTS,
  AGENT_REFERENCE_UNC_TIMEOUT_MS,
  AgentReferenceActionService,
} from "../agent-reference-action-service"
import type { AuditSink, PermissionGuard } from "../../runtime/security"

const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    const { rm } = await import("node:fs/promises")
    await rm(directory, { recursive: true, force: true })
  }))
})

describe("AgentReferenceActionService", () => {
  it("opens the parsed file target once and audits the explicit user action", async () => {
    const directory = await temporaryDirectory()
    const filePath = path.join(directory, "file with spaces.txt")
    await writeFile(filePath, "content")
    const realFilePath = await realpath(filePath)
    const harness = createHarness()

    await expect(harness.service.openDefault(request(directory, "file with spaces.txt:12:3")))
      .resolves.toEqual({ ok: true })

    expect(harness.openPath).toHaveBeenCalledTimes(1)
    expect(harness.openPath).toHaveBeenCalledWith(realFilePath)
    expect(harness.permissionGuard.check.mock.calls.map(([entry]) => entry.action)).toEqual([
      "fs.read.outside-userdata",
      "fs.read.outside-userdata",
      "shell.exec",
    ])
    expect(harness.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      actor: { kind: "user", id: "renderer" },
      resource: realFilePath,
      outcome: "allowed",
      metadata: expect.objectContaining({
        projectId: "project-1",
        operation: "open_default",
        source: "agent.reference.context-menu",
      }),
    }))
    expect(JSON.stringify(harness.auditSink.record.mock.calls)).not.toContain("messageId")
  })

  it("opens directories with the operating-system default action", async () => {
    const directory = await temporaryDirectory()
    const target = path.join(directory, "folder")
    await mkdir(target)
    const realTarget = await realpath(target)
    const harness = createHarness()

    await expect(harness.service.openDefault(request(directory, "folder"))).resolves.toEqual({ ok: true })

    expect(harness.openPath).toHaveBeenCalledOnce()
    expect(harness.openPath).toHaveBeenCalledWith(realTarget)
  })

  it("resolves ../ references from the current project root without sandboxing them", async () => {
    const directory = await temporaryDirectory()
    const projectRoot = path.join(directory, "project")
    const outsidePath = path.join(directory, "outside.txt")
    await mkdir(projectRoot)
    await writeFile(outsidePath, "content")
    const realOutsidePath = await realpath(outsidePath)
    const harness = createHarness()

    await expect(harness.service.openDefault(request(projectRoot, "../outside.txt")))
      .resolves.toEqual({ ok: true })

    expect(harness.permissionGuard.check).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: "fs.read.outside-userdata",
        resource: outsidePath,
      }),
    )
    expect(harness.openPath).toHaveBeenCalledWith(realOutsidePath)
  })

  it("resolves an ancestor symbolic link and reauthorizes the real target", async () => {
    const directory = await temporaryDirectory()
    const realDirectory = path.join(directory, "real")
    const linkedDirectory = path.join(directory, "linked")
    await mkdir(realDirectory)
    await writeFile(path.join(realDirectory, "file.txt"), "content")
    await symlink(realDirectory, linkedDirectory)
    const harness = createHarness()
    const realFilePath = await realpath(path.join(realDirectory, "file.txt"))

    await expect(harness.service.openDefault(request(directory, "linked/file.txt")))
      .resolves.toEqual({ ok: true })

    expect(harness.permissionGuard.check).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: "fs.read.outside-userdata",
        resource: realFilePath,
      }),
    )
    expect(harness.openPath).toHaveBeenCalledWith(realFilePath)
  })

  it("accepts APFS case normalization when the surface and real paths identify the same file", async () => {
    const fileStats = fakeStats("file", 7)
    const directoryStats = fakeStats("directory", 8)
    const lstat = vi.fn(async (targetPath: string) =>
      targetPath === "/project" ? directoryStats : fileStats)
    const harness = createHarness({
      platform: "darwin",
      lstat,
      realpath: vi.fn(async (targetPath) => {
        if (targetPath === "/project/file.txt") return "/project/File.txt"
        return targetPath
      }),
    })

    await expect(harness.service.openDefault(request("/project", "/project/file.txt")))
      .resolves.toEqual({ ok: true })

    expect(harness.openPath).toHaveBeenCalledWith("/project/File.txt")
  })

  it("rejects a leaf symbolic link for default open but locates a dangling link itself", async () => {
    const directory = await temporaryDirectory()
    const linkPath = path.join(directory, "missing-link")
    await symlink(path.join(directory, "missing-target"), linkPath)
    const realParent = await realpath(directory)
    const harness = createHarness()

    await expect(harness.service.openDefault(request(directory, "missing-link")))
      .resolves.toEqual({ ok: false, code: "symbolic_link_not_supported" })
    await expect(harness.service.showInFolder(request(directory, "missing-link")))
      .resolves.toEqual({ ok: true })

    expect(harness.openPath).not.toHaveBeenCalled()
    expect(harness.showItemInFolder).toHaveBeenCalledOnce()
    expect(harness.showItemInFolder).toHaveBeenCalledWith(path.join(realParent, "missing-link"))
  })

  it("returns no_parent_directory instead of falling back to opening a root", async () => {
    const stats = fakeStats("directory")
    const harness = createHarness({
      lstat: vi.fn(async () => stats),
      realpath: vi.fn(async (value) => value),
    })

    await expect(harness.service.openDefault(request("/project", "/")))
      .resolves.toEqual({ ok: true })
    await expect(harness.service.showInFolder(request("/project", "/")))
      .resolves.toEqual({ ok: false, code: "no_parent_directory" })

    expect(harness.openPath).toHaveBeenCalledWith("/")
    expect(harness.showItemInFolder).not.toHaveBeenCalled()
  })

  it("rejects special filesystem entries", async () => {
    const harness = createHarness({
      lstat: vi.fn(async () => fakeStats("special")),
      realpath: vi.fn(async (value) => value),
    })

    await expect(harness.service.openDefault(request("/project", "/project/socket")))
      .resolves.toEqual({ ok: false, code: "unsupported_object_type" })
    await expect(harness.service.showInFolder(request("/project", "/project/socket")))
      .resolves.toEqual({ ok: false, code: "unsupported_object_type" })
  })

  it("returns permission_denied before reading a denied target", async () => {
    const permissionGuard = fakePermissionGuard()
    permissionGuard.check.mockResolvedValue({
      allowed: false as const,
      reason: "blocked",
      policyId: "policy-1",
    })
    const lstat = vi.fn(async () => fakeStats("file"))
    const harness = createHarness({ permissionGuard, lstat })

    await expect(harness.service.openDefault(request("/project", "/project/file.txt")))
      .resolves.toEqual({ ok: false, code: "permission_denied" })

    expect(lstat).not.toHaveBeenCalled()
    expect(harness.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      outcome: "denied",
      resource: "/project/file.txt",
    }))
  })

  it("rejects invalid and foreign Windows paths before filesystem access", async () => {
    const lstat = vi.fn(async () => fakeStats("file"))
    const harness = createHarness({
      platform: "win32",
      lstat,
      realpath: vi.fn(async (value) => value),
    })

    await expect(harness.service.openDefault(request("C:\\project", "/Users/test/file.txt")))
      .resolves.toEqual({ ok: false, code: "foreign_platform_path" })
    await expect(harness.service.openDefault(request("C:\\project", "\\\\?\\C:\\private\\file.txt")))
      .resolves.toEqual({ ok: false, code: "invalid_reference" })
    await expect(harness.service.openDefault(request("C:\\project", "\\\\.\\pipe\\private")))
      .resolves.toEqual({ ok: false, code: "invalid_reference" })
    await expect(harness.service.openDefault(request("C:\\project", "\\??\\C:\\private\\file.txt")))
      .resolves.toEqual({ ok: false, code: "invalid_reference" })
    await expect(harness.service.openDefault(request("C:\\project", "C:\\private\\file.txt:stream")))
      .resolves.toEqual({ ok: false, code: "invalid_reference" })
    await expect(harness.service.openDefault(request("C:\\project", "x".repeat(AGENT_REFERENCE_MAX_CODE_POINTS + 1))))
      .resolves.toEqual({ ok: false, code: "invalid_reference" })

    expect(lstat).not.toHaveBeenCalled()
    expect(harness.permissionGuard.check).not.toHaveBeenCalled()
    expect(harness.auditSink.record).not.toHaveBeenCalled()
  })

  it("rejects Windows absolute forms on a POSIX platform instead of resolving them relatively", async () => {
    const lstat = vi.fn(async () => fakeStats("file"))
    const harness = createHarness({
      platform: "darwin",
      lstat,
      realpath: vi.fn(async (value) => value),
    })

    await expect(harness.service.openDefault(request("/project", "C:\\private\\file.txt")))
      .resolves.toEqual({ ok: false, code: "foreign_platform_path" })
    await expect(harness.service.openDefault(request("/project", "\\\\server\\share\\file.txt")))
      .resolves.toEqual({ ok: false, code: "foreign_platform_path" })

    expect(lstat).not.toHaveBeenCalled()
  })

  it.each(["ENOENT", "EACCES"])(
    "maps expected initial lstat %s failures to not_found_or_inaccessible",
    async (code) => {
      const harness = createHarness({
        lstat: vi.fn(async () => {
          throw filesystemError(code)
        }),
      })

      await expect(harness.service.openDefault(request("/project", "missing.txt")))
        .resolves.toEqual({ ok: false, code: "not_found_or_inaccessible" })

      expect(harness.auditSink.record.mock.calls.map(([entry]) => ({
        action: entry.action,
        outcome: entry.outcome,
        resource: entry.resource,
      }))).toEqual([
        {
          action: "fs.read.outside-userdata",
          outcome: "allowed",
          resource: "/project/missing.txt",
        },
        {
          action: "fs.read.outside-userdata",
          outcome: "failed",
          resource: "/project/missing.txt",
        },
      ])
    },
  )

  it("maps an expected realpath access failure to not_found_or_inaccessible", async () => {
    const harness = createHarness({
      lstat: vi.fn(async () => fakeStats("file")),
      realpath: vi.fn(async () => {
        throw filesystemError("EACCES")
      }),
    })

    await expect(harness.service.openDefault(request("/project", "/project/file.txt")))
      .resolves.toEqual({ ok: false, code: "not_found_or_inaccessible" })

    expect(harness.openPath).not.toHaveBeenCalled()
  })

  it("rejects a plain initial filesystem Error instead of assigning a business code", async () => {
    const failure = new Error("unexpected lstat invariant")
    const harness = createHarness({
      lstat: vi.fn(async () => {
        throw failure
      }),
    })

    await expect(harness.service.openDefault(request("/project", "/project/file.txt")))
      .rejects.toBe(failure)
  })

  it("rejects an unknown realpath errno instead of assigning a business code", async () => {
    const failure = filesystemError("EIO")
    const harness = createHarness({
      lstat: vi.fn(async () => fakeStats("file")),
      realpath: vi.fn(async () => {
        throw failure
      }),
    })

    await expect(harness.service.openDefault(request("/project", "/project/file.txt")))
      .rejects.toBe(failure)
  })

  it("checks the UNC server/share permission before filesystem permissions", async () => {
    const stats = fakeStats("file")
    const harness = createHarness({
      platform: "win32",
      lstat: vi.fn(async () => stats),
      realpath: vi.fn(async (value) => value),
    })

    await expect(harness.service.openDefault(request(
      "C:\\project",
      "\\\\server\\share\\folder\\file.txt",
    ))).resolves.toEqual({ ok: true })

    expect(harness.permissionGuard.check.mock.calls.map(([entry]) => [
      entry.action,
      entry.resource,
    ])).toEqual([
      ["network.connect", "\\\\server\\share"],
      ["fs.read.outside-userdata", "\\\\server\\share\\folder\\file.txt"],
      ["fs.read.outside-userdata", "\\\\server\\share\\folder\\file.txt"],
      ["shell.exec", "\\\\server\\share\\folder\\file.txt"],
    ])
    expect(harness.auditSink.record).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: "network.connect",
        resource: "\\\\server\\share",
        outcome: "allowed",
      }),
    )
  })

  it("opens a UNC share root but does not locate it without a parent entry", async () => {
    const stats = fakeStats("directory")
    const harness = createHarness({
      platform: "win32",
      lstat: vi.fn(async () => stats),
      realpath: vi.fn(async (value) => value),
    })
    const reference = "\\\\server\\share\\"

    await expect(harness.service.openDefault(request("C:\\project", reference)))
      .resolves.toEqual({ ok: true })
    await expect(harness.service.showInFolder(request("C:\\project", reference)))
      .resolves.toEqual({ ok: false, code: "no_parent_directory" })

    expect(harness.openPath).toHaveBeenCalledWith(reference)
    expect(harness.showItemInFolder).not.toHaveBeenCalled()
  })

  it("treats a redirecting Windows leaf as a symbolic link boundary", async () => {
    const harness = createHarness({
      platform: "win32",
      lstat: vi.fn(async (targetPath) =>
        fakeStats("file", targetPath === "D:\\target\\entry" ? 2 : 1)),
      realpath: vi.fn(async (value) =>
        value === "C:\\folder\\entry" ? "D:\\target\\entry" : value),
    })

    await expect(harness.service.openDefault(request("C:\\project", "C:\\folder\\entry")))
      .resolves.toEqual({ ok: false, code: "symbolic_link_not_supported" })

    expect(harness.openPath).not.toHaveBeenCalled()
  })

  it("times out UNC preflight without submitting a late system call", async () => {
    vi.useFakeTimers()
    const permissionGuard = fakePermissionGuard()
    permissionGuard.check.mockImplementation(() => new Promise(() => undefined))
    const harness = createHarness({ platform: "win32", permissionGuard })
    const pending = harness.service.openDefault(request(
      "C:\\project",
      "\\\\server\\share\\folder\\file.txt",
    ))

    await vi.advanceTimersByTimeAsync(AGENT_REFERENCE_UNC_TIMEOUT_MS)
    await expect(pending).resolves.toEqual({ ok: false, code: "network_timeout" })
    expect(harness.openPath).not.toHaveBeenCalled()
  })

  it("stops before submission when the sender aborts during preflight", async () => {
    const controller = new AbortController()
    const permissionGuard = fakePermissionGuard()
    permissionGuard.check.mockImplementation(() => new Promise(() => undefined))
    const harness = createHarness({ permissionGuard })
    const pending = harness.service.openDefault({
      ...request("/project", "/project/file.txt"),
      abortSignal: controller.signal,
    })

    controller.abort()

    await expect(pending).resolves.toEqual({ ok: false, code: "cancelled_before_submission" })
    expect(harness.openPath).not.toHaveBeenCalled()
    expect(harness.auditSink.record).not.toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
    }))
  })

  it.each(["open_default", "show_in_folder"] as const)(
    "preserves completed filesystem audits when %s aborts during later filesystem work",
    async (action) => {
      const controller = new AbortController()
      const fileStats = fakeStats("file")
      const lstat = vi.fn(async () => {
        if (lstat.mock.calls.length === 1) return fileStats
        return new Promise<Stats>(() => undefined)
      })
      const harness = createHarness({
        lstat,
        realpath: vi.fn(async (value) => value),
      })
      const actionRequest = {
        ...request("/project", "/project/file.txt"),
        abortSignal: controller.signal,
      }
      const pending = action === "open_default"
        ? harness.service.openDefault(actionRequest)
        : harness.service.showInFolder(actionRequest)

      await vi.waitFor(() => {
        expect(harness.permissionGuard.check).toHaveBeenCalledTimes(2)
        expect(lstat).toHaveBeenCalledTimes(2)
      })
      controller.abort()

      await expect(pending).resolves.toEqual({
        ok: false,
        code: "cancelled_before_submission",
      })
      expect(harness.auditSink.record.mock.calls
        .filter(([entry]) =>
          entry.action === "fs.read.outside-userdata" && entry.outcome === "allowed")
        .map(([entry]) => entry.metadata?.stage))
        .toEqual(action === "open_default" ? ["surface", "real"] : ["surface", "parent"])
      expect(harness.auditSink.record).not.toHaveBeenCalledWith(expect.objectContaining({
        action: "shell.exec",
      }))
      expect(harness.openPath).not.toHaveBeenCalled()
      expect(harness.showItemInFolder).not.toHaveBeenCalled()
    },
  )

  it("does not start permission or filesystem work for an already-destroyed sender", async () => {
    const controller = new AbortController()
    controller.abort()
    const lstat = vi.fn(async () => fakeStats("file"))
    const harness = createHarness({ lstat })

    await expect(harness.service.openDefault({
      ...request("/project", "/project/file.txt"),
      abortSignal: controller.signal,
    })).resolves.toEqual({ ok: false, code: "cancelled_before_submission" })

    expect(harness.permissionGuard.check).not.toHaveBeenCalled()
    expect(lstat).not.toHaveBeenCalled()
  })

  it("returns target_changed when identity changes before the system call", async () => {
    const stable = fakeStats("file", 1)
    const changed = fakeStats("file", 2)
    const lstat = vi.fn()
      .mockResolvedValueOnce(stable)
      .mockResolvedValueOnce(stable)
      .mockResolvedValueOnce(changed)
    const harness = createHarness({
      lstat,
      realpath: vi.fn(async (value) => value),
    })

    await expect(harness.service.openDefault(request("/project", "/project/file.txt")))
      .resolves.toEqual({ ok: false, code: "target_changed" })

    expect(harness.permissionGuard.check.mock.calls.map(([entry]) => entry.action)).toEqual([
      "fs.read.outside-userdata",
      "fs.read.outside-userdata",
    ])
    expect(harness.auditSink.record.mock.calls
      .filter(([entry]) => entry.action === "fs.read.outside-userdata")
      .map(([entry]) => ({
        outcome: entry.outcome,
        stage: entry.metadata?.stage,
      }))).toEqual([
      { outcome: "allowed", stage: "surface" },
      { outcome: "allowed", stage: "real" },
      { outcome: "failed", stage: "recheck" },
    ])
    expect(harness.openPath).not.toHaveBeenCalled()
  })

  it.each(["open_default", "show_in_folder"] as const)(
    "maps expected %s final revalidation access failures to target_changed",
    async (action) => {
      const lstat = vi.fn()
        .mockResolvedValueOnce(fakeStats("file"))
        .mockResolvedValueOnce(action === "open_default"
          ? fakeStats("file")
          : fakeStats("directory", 2))
        .mockRejectedValueOnce(filesystemError("EACCES"))
      const harness = createHarness({
        lstat,
        realpath: vi.fn(async (value) => value),
      })

      const result = action === "open_default"
        ? await harness.service.openDefault(request("/project", "/project/file.txt"))
        : await harness.service.showInFolder(request("/project", "/project/file.txt"))

      expect(result).toEqual({ ok: false, code: "target_changed" })
      expect(harness.openPath).not.toHaveBeenCalled()
      expect(harness.showItemInFolder).not.toHaveBeenCalled()
    },
  )

  it.each(["open_default", "show_in_folder"] as const)(
    "rejects unknown %s final revalidation errors",
    async (action) => {
      const failure = filesystemError("EIO")
      const lstat = vi.fn()
        .mockResolvedValueOnce(fakeStats("file"))
        .mockResolvedValueOnce(action === "open_default"
          ? fakeStats("file")
          : fakeStats("directory", 2))
        .mockRejectedValueOnce(failure)
      const harness = createHarness({
        lstat,
        realpath: vi.fn(async (value) => value),
      })
      const pending = action === "open_default"
        ? harness.service.openDefault(request("/project", "/project/file.txt"))
        : harness.service.showInFolder(request("/project", "/project/file.txt"))

      await expect(pending).rejects.toBe(failure)
      expect(harness.openPath).not.toHaveBeenCalled()
      expect(harness.showItemInFolder).not.toHaveBeenCalled()
    },
  )

  it("revalidates the reveal target before requesting shell permission", async () => {
    const stableFile = fakeStats("file", 1)
    const changedFile = fakeStats("file", 2)
    const stableDirectory = fakeStats("directory", 3)
    const lstat = vi.fn()
      .mockResolvedValueOnce(stableFile)
      .mockResolvedValueOnce(stableDirectory)
      .mockResolvedValueOnce(changedFile)
      .mockResolvedValueOnce(stableDirectory)
    const harness = createHarness({
      lstat,
      realpath: vi.fn(async (value) => value),
    })

    await expect(harness.service.showInFolder(request("/project", "/project/file.txt")))
      .resolves.toEqual({ ok: false, code: "target_changed" })

    expect(harness.permissionGuard.check.mock.calls.map(([entry]) => entry.action)).toEqual([
      "fs.read.outside-userdata",
      "fs.read.outside-userdata",
    ])
    expect(harness.showItemInFolder).not.toHaveBeenCalled()
  })

  it.each(["open_default", "show_in_folder"] as const)(
    "places final revalidation before shell permission and the %s native call",
    async (action) => {
      const events: string[] = []
      const permissionGuard = fakePermissionGuard()
      permissionGuard.check.mockImplementation(async (entry) => {
        events.push(`permission:${entry.action}`)
        return { allowed: true as const }
      })
      const stats = fakeStats("file")
      const directoryStats = fakeStats("directory", 2)
      const lstat = vi.fn(async (targetPath: string) => {
        events.push(`lstat:${targetPath}`)
        return targetPath === "/project" ? directoryStats : stats
      })
      const openPath = vi.fn(async () => {
        events.push("native:open")
        return ""
      })
      const showItemInFolder = vi.fn(() => {
        events.push("native:reveal")
      })
      const harness = createHarness({
        permissionGuard,
        lstat,
        realpath: vi.fn(async (value) => value),
        openPath,
        showItemInFolder,
      })

      const result = action === "open_default"
        ? await harness.service.openDefault(request("/project", "/project/file.txt"))
        : await harness.service.showInFolder(request("/project", "/project/file.txt"))

      expect(result).toEqual({ ok: true })
      const shellPermissionIndex = events.indexOf("permission:shell.exec")
      const nativeCallIndex = events.indexOf(action === "open_default" ? "native:open" : "native:reveal")
      const finalRevalidationIndex = events
        .map((event, index) => event.startsWith("lstat:") ? index : -1)
        .filter((index) => index >= 0)
        .at(-1) ?? -1
      expect(finalRevalidationIndex).toBeLessThan(shellPermissionIndex)
      expect(shellPermissionIndex).toBeLessThan(nativeCallIndex)
    },
  )

  it.each(["open_default", "show_in_folder"] as const)(
    "checks sender state after shell permission before the %s native call",
    async (action) => {
      const controller = new AbortController()
      const permissionGuard = fakePermissionGuard()
      permissionGuard.check.mockImplementation(async (entry) => {
        if (entry.action === "shell.exec") controller.abort()
        return { allowed: true as const }
      })
      const stats = fakeStats("file")
      const directoryStats = fakeStats("directory", 2)
      const harness = createHarness({
        permissionGuard,
        lstat: vi.fn(async (targetPath) =>
          targetPath === "/project" ? directoryStats : stats),
        realpath: vi.fn(async (value) => value),
      })
      const actionRequest = {
        ...request("/project", "/project/file.txt"),
        abortSignal: controller.signal,
      }

      const result = action === "open_default"
        ? await harness.service.openDefault(actionRequest)
        : await harness.service.showInFolder(actionRequest)

      expect(result).toEqual({ ok: false, code: "cancelled_before_submission" })
      expect(harness.openPath).not.toHaveBeenCalled()
      expect(harness.showItemInFolder).not.toHaveBeenCalled()
      expect(harness.auditSink.record).not.toHaveBeenCalledWith(expect.objectContaining({
        action: "shell.exec",
      }))
    },
  )

  it("returns stable system errors without exposing a path", async () => {
    const directory = await temporaryDirectory()
    const filePath = path.join(directory, "file.txt")
    await writeFile(filePath, "content")
    const rejected = createHarness({ openPath: vi.fn(async () => "native rejection with path") })
    const failed = createHarness({ openPath: vi.fn(async () => {
      throw new Error("native failure with path")
    }) })

    await expect(rejected.service.openDefault(request(directory, "file.txt")))
      .resolves.toEqual({ ok: false, code: "system_rejected" })
    await expect(failed.service.openDefault(request(directory, "file.txt")))
      .resolves.toEqual({ ok: false, code: "system_failed" })
    expect(failed.auditSink.record.mock.calls.map(([entry]) => ({
      action: entry.action,
      outcome: entry.outcome,
      stage: entry.metadata?.stage,
    }))).toEqual([
      { action: "fs.read.outside-userdata", outcome: "allowed", stage: "surface" },
      { action: "fs.read.outside-userdata", outcome: "allowed", stage: "real" },
      { action: "shell.exec", outcome: "failed", stage: "system" },
    ])
  })
})

function request(projectRoot: string, reference: string) {
  return {
    projectId: "project-1",
    projectRoot,
    reference,
    actor: { kind: "user" as const, id: "renderer" },
  }
}

function createHarness(overrides: {
  readonly platform?: NodeJS.Platform
  readonly permissionGuard?: ReturnType<typeof fakePermissionGuard>
  readonly lstat?: (targetPath: string) => Promise<Stats>
  readonly realpath?: (targetPath: string) => Promise<string>
  readonly openPath?: (targetPath: string) => Promise<string>
  readonly showItemInFolder?: (targetPath: string) => void
} = {}) {
  const permissionGuard = overrides.permissionGuard ?? fakePermissionGuard()
  const auditSink = fakeAuditSink()
  const openPath = overrides.openPath ?? vi.fn(async () => "")
  const showItemInFolder = overrides.showItemInFolder ?? vi.fn()
  const service = new AgentReferenceActionService({
    permissionGuard,
    auditSink,
    openPath,
    showItemInFolder,
    platform: overrides.platform,
    lstat: overrides.lstat,
    realpath: overrides.realpath,
  })
  return { service, permissionGuard, auditSink, openPath, showItemInFolder }
}

function fakePermissionGuard(): PermissionGuard & { check: ReturnType<typeof vi.fn> } {
  return {
    registerPolicy: () => () => undefined,
    check: vi.fn(async () => ({ allowed: true as const })),
  }
}

function fakeAuditSink(): AuditSink & { record: ReturnType<typeof vi.fn> } {
  return {
    record: vi.fn<AuditSink["record"]>(),
    list: vi.fn(() => []),
    clearForTests: vi.fn(),
  }
}

function fakeStats(kind: "file" | "directory" | "symbolic-link" | "special", identity = 1): Stats {
  return {
    dev: identity,
    ino: identity,
    mode: identity,
    isFile: () => kind === "file",
    isDirectory: () => kind === "directory",
    isSymbolicLink: () => kind === "symbolic-link",
  } as Stats
}

function filesystemError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`filesystem ${code}`), { code })
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-reference-"))
  temporaryDirectories.push(directory)
  return directory
}
