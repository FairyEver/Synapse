import { beforeEach, describe, expect, it, vi } from "vitest"

import { createInMemoryHarness } from "../../../runtime/ipc"
import { shellIpcModule } from "../ipc"

const electronMock = vi.hoisted(() => ({
  shell: {
    openExternal: vi.fn(),
    showItemInFolder: vi.fn(),
  },
}))

vi.mock("electron", () => ({
  shell: electronMock.shell,
}))

describe("shellIpcModule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("opens http links through the system shell", async () => {
    const harness = createHarness()
    electronMock.shell.openExternal.mockResolvedValue(undefined)

    await harness.invoke("synapse:shell:open-external", {
      url: "https://example.com/path",
    })

    expect(electronMock.shell.openExternal).toHaveBeenCalledWith("https://example.com/path")
  })

  it("rejects non-web external links", async () => {
    const harness = createHarness()

    await expect(harness.invoke("synapse:shell:open-external", {
      url: "file:///Users/test/secret.txt",
    })).rejects.toThrow()

    expect(electronMock.shell.openExternal).not.toHaveBeenCalled()
  })
})

function createHarness() {
  const harness = createInMemoryHarness()
  harness.registry.register(shellIpcModule, {
    moduleId: "shell",
    resolve: () => {
      throw new Error("shell IPC does not resolve services")
    },
  })
  return harness
}
