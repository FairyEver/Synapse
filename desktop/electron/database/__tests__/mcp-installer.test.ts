import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock("../mcp-server", () => ({
  getMcpServerToken: () => "token",
}))

vi.mock("../../services/log-store", () => ({
  createMainLogger: () => mocks.logger,
}))

vi.mock("electron", () => ({
  shell: {
    openPath: vi.fn(),
  },
}))

const roots: string[] = []

afterEach(async () => {
  vi.resetModules()
  vi.doUnmock("node:os")
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("mcp-installer", () => {
  it("preserves damaged settings read state instead of reporting unregistered", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "synapse-mcp-home-"))
    roots.push(home)
    await mkdir(home, { recursive: true })
    await writeFile(path.join(home, ".claude.json"), "{", "utf8")
    vi.doMock("node:os", async () => ({
      ...(await vi.importActual<typeof import("node:os")>("node:os")),
      homedir: () => home,
    }))

    const { getMcpServers } = await import("../mcp-installer")

    const claude = getMcpServers().find((server) => server.target === "claude")
    expect(claude).toMatchObject({
      target: "claude",
      settingsFileExists: true,
      registered: false,
      mode: null,
      readError: "配置读取失败",
    })
    expect(mocks.logger.warn).toHaveBeenCalledWith("MCP settings read failed.", {
      target: "claude",
      errorName: "Error",
      errorLength: expect.any(Number),
    })
  })
})
