import type { Stats } from "node:fs"
import { describe, expect, it, vi } from "vitest"
import { FileOpenerService } from "../service"

function createService(options: {
  readonly isFile?: boolean
  readonly isSymbolicLink?: boolean
  readonly openResult?: string
  readonly allowed?: boolean
  readonly lstatError?: Error
  readonly openError?: Error
} = {}) {
  const auditSink = { record: vi.fn(), list: vi.fn(() => []), clearForTests: vi.fn() }
  const openPath = vi.fn(async () => {
    if (options.openError) throw options.openError
    return options.openResult ?? ""
  })
  const permissionGuard = {
    registerPolicy: vi.fn(() => vi.fn()),
    check: vi.fn(async () => options.allowed === false
      ? { allowed: false as const, reason: "denied", policyId: "test" }
      : { allowed: true as const }),
  }
  const lstat = vi.fn(async () => {
    if (options.lstatError) throw options.lstatError
    return ({
      isFile: () => options.isFile ?? true,
      isSymbolicLink: () => options.isSymbolicLink ?? false,
    }) as Stats
  })
  return {
    auditSink,
    lstat,
    openPath,
    service: new FileOpenerService({ auditSink, lstat, openPath, permissionGuard }),
  }
}

describe("FileOpenerService", () => {
  it("opens one absolute regular file and returns only its path", async () => {
    const test = createService()
    await expect(test.service.open({ path: "/tmp/report.txt" })).resolves.toEqual({ path: "/tmp/report.txt" })
    expect(test.openPath).toHaveBeenCalledWith("/tmp/report.txt")
    expect(test.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({ action: "shell.exec", outcome: "allowed" }))
  })

  it.each([
    ["relative path", { path: "report.txt" }, "invalid_path"],
    ["symbolic link", { path: "/tmp/report.txt" }, "symbolic_link_not_supported"],
    ["directory", { path: "/tmp/report.txt" }, "not_regular_file"],
    ["permission denial", { path: "/tmp/report.txt" }, "permission_denied"],
    ["system rejection", { path: "/tmp/report.txt" }, "system_rejected"],
    ["inaccessible file", { path: "/tmp/report.txt" }, "file_not_found_or_inaccessible"],
    ["open failure", { path: "/tmp/report.txt" }, "open_failed"],
  ])("returns a stable error for %s", async (caseName, input, code) => {
    const options = caseName === "symbolic link"
      ? { isSymbolicLink: true }
      : caseName === "directory"
        ? { isFile: false }
        : caseName === "permission denial"
          ? { allowed: false }
          : caseName === "system rejection"
            ? { openResult: "system detail" }
            : caseName === "inaccessible file"
              ? { lstatError: new Error("private system detail") }
              : caseName === "open failure"
                ? { openError: new Error("private system detail") }
            : {}
    await expect(createService(options).service.open(input)).rejects.toMatchObject({ code })
  })
})
