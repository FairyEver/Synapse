import { afterEach, describe, expect, it, vi } from "vitest"

const execFileMock = vi.hoisted(() => vi.fn())
const accessMock = vi.hoisted(() =>
  vi.fn<(_filePath: string) => Promise<void>>(async (_filePath) => {
    throw new Error("missing")
  }),
)

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}))

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  return {
    ...actual,
    access: accessMock,
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

afterEach(() => {
  execFileMock.mockReset()
  accessMock.mockReset()
  accessMock.mockImplementation(async (_filePath: string) => {
    throw new Error("missing")
  })
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
    }
  })

  it("checks Windows npm cmd shims before falling back to where", async () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")
    const previousEnv = {
      APPDATA: process.env.APPDATA,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
    }
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    })
    process.env.APPDATA = "C:\\Users\\Ada\\AppData\\Roaming"
    process.env.LOCALAPPDATA = "C:\\Users\\Ada\\AppData\\Local"
    accessMock.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith("AppData\\Roaming/npm/claude.cmd")) return
      throw new Error("missing")
    })

    try {
      const { whichBin } = await import("../binary-detect-service")

      await expect(whichBin("claude")).resolves.toMatch(/claude\.cmd$/)
      expect(execFileMock).not.toHaveBeenCalled()
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
})
