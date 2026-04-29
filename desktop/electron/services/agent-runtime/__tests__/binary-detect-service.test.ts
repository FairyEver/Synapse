import { describe, expect, it, vi } from "vitest"

const execFileMock = vi.hoisted(() => vi.fn())

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}))

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  return {
    ...actual,
    access: vi.fn(async () => {
      throw new Error("missing")
    }),
  }
})

vi.mock("node:util", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:util")>()
  return {
    ...actual,
    promisify: (fn: typeof execFileMock) =>
      (...args: unknown[]) =>
        new Promise((resolve, reject) => {
          fn(...args, (error: Error | null, stdout: string, stderr: string) => {
            if (error) reject(error)
            else resolve({ stdout, stderr })
          })
        }),
  }
})

describe("whichBin", () => {
  it("trims CRLF from Windows where output", async () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    })
    execFileMock.mockImplementation((_command, _args, _options, callback) => {
      callback(
        null,
        "C:\\Users\\Ada\\AppData\\Roaming\\npm\\codex.cmd\r\nC:\\Program Files\\Codex\\codex.exe\r\n",
        "",
      )
    })

    try {
      const { whichBin } = await import("../binary-detect-service")

      await expect(whichBin("codex")).resolves.toBe(
        "C:\\Users\\Ada\\AppData\\Roaming\\npm\\codex.cmd",
      )
    } finally {
      if (platformDescriptor) {
        Object.defineProperty(process, "platform", platformDescriptor)
      }
      execFileMock.mockReset()
    }
  })
})
