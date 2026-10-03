import { describe, expect, it } from "vitest"
import { formatDroppedTerminalPaths, formatTerminalPathReference } from "../path-reference"

describe("terminal path references", () => {
  it("retains the desktop multiple-path drop and POSIX shell escaping", () => {
    expect(formatDroppedTerminalPaths(["/tmp/one file", "/tmp/中文😀'\"$`!"], "darwin", "/bin/zsh")).toBe("/tmp/one\\ file /tmp/中文😀\\'\\\"\\$\\`\\! ")
  })
  it("quotes PowerShell literals and ordinary CMD paths using their own rules", () => {
    expect(formatTerminalPathReference("C:\\O'Brien $test`😀", "win32", "C:\\Windows\\PowerShell\\powershell.exe")).toBe("'C:\\O''Brien $test`😀'")
    expect(formatDroppedTerminalPaths(["C:\\one file", "D:\\two"], "win32", "cmd.exe")).toBe('"C:\\one file" "D:\\two" ')
    expect(formatDroppedTerminalPaths(["/c/one file", "/d/中文😀"], "win32", "C:\\Program Files\\Git\\bin\\bash.exe")).toBe("/c/one\\ file /d/中文😀 ")
    expect(formatTerminalPathReference("/tmp/$`'hello", "darwin", "/usr/local/bin/pwsh")).toBe("'/tmp/$`''hello'")
  })
  it("preserves native desktop Windows Bash drops while mobile references remain strict", () => {
    const shell = "C:\\Program Files\\Git\\bin\\bash.exe"
    expect(formatDroppedTerminalPaths(["C:\\Users\\Li Yang\\report & notes.txt", "D:\\中文😀\\O'Neil$`!.txt"], "win32", shell)).toBe("C:\\\\Users\\\\Li\\ Yang\\\\report\\ \\&\\ notes.txt D:\\\\中文😀\\\\O\\'Neil\\$\\`\\!.txt ")
    expect(formatDroppedTerminalPaths(["\\\\server\\share\\one file.txt"], "win32", shell)).toBe("\\\\\\\\server\\\\share\\\\one\\ file.txt ")
    for (const target of ["C:\\Users\\file.txt", "C:/Users/file.txt", "\\\\server\\share\\file.txt"]) {
      expect(() => formatTerminalPathReference(target, "win32", shell)).toThrow("unsupported_platform")
    }
    for (const target of ["C:\\bad\nname.txt", "\\\\server\\share\\bad\0name"]) {
      expect(() => formatDroppedTerminalPaths([target], "win32", shell)).toThrow("unsafe_path")
    }
    expect(() => formatDroppedTerminalPaths(["C:\\file.txt"], "win32", "custom-shell.exe")).toThrow("unsupported_platform")
  })
  it("refuses CMD expansion, unknown Windows shells, and control characters", () => {
    for (const target of ["C:\\%PATH%", "C:\\!HOME!", 'C:\\"quote']) expect(() => formatTerminalPathReference(target, "win32", "cmd.exe")).toThrow("unsupported_platform")
    expect(() => formatTerminalPathReference("C:\\test", "win32", "custom-shell.exe")).toThrow("unsupported_platform")
    for (const target of ["/tmp/\0", "/tmp/\n", "/tmp/\t"]) expect(() => formatTerminalPathReference(target, "darwin", "/bin/zsh")).toThrow("unsafe_path")
  })
})
