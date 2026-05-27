import { describe, expect, it } from "vitest"

import { resolveEffectiveShell, resolveShellCommand } from "../shell-exec"

describe("resolveShellCommand", () => {
  it("defaults to cmd on Windows when requested", () => {
    expect(resolveShellCommand(undefined, "echo ok", {
      platform: "win32",
      windowsDefault: "cmd",
    })).toEqual({
      shell: "cmd",
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "echo ok"],
    })
  })

  it("resolves the same effective Windows shell before command construction", () => {
    expect(resolveEffectiveShell(undefined, {
      platform: "win32",
      windowsDefault: "powershell",
    })).toBe("powershell")
  })

  it("can select PowerShell explicitly", () => {
    expect(resolveShellCommand("powershell", "Write-Output ok", { platform: "win32" }))
      .toEqual({
        shell: "powershell",
        command: "powershell.exe",
        args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "Write-Output ok"],
      })
  })

  it("uses sh for POSIX commands on Windows and /bin/sh elsewhere", () => {
    expect(resolveShellCommand("posix", "echo ok", { platform: "win32" }).command)
      .toBe("sh")
    expect(resolveShellCommand("posix", "echo ok", { platform: "darwin" })).toEqual({
      shell: "posix",
      command: "/bin/sh",
      args: ["-lc", "echo ok"],
    })
  })
})
