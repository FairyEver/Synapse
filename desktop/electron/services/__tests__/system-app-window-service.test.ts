import { describe, expect, it, vi } from "vitest"

const defaultLoggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

import { createSystemAppWindowService } from "../system-app-window-service"
import { getSystemAppDefinition } from "../../../src/modules/apps/definitions"

type BroadcastFilter = (window: { readonly id: number }) => boolean

vi.mock("../log-store", () => ({
  createMainLogger: () => defaultLoggerMock,
}))

describe("createSystemAppWindowService", () => {
  it("opens and retargets a Todo window without sending its target to other windows", async () => {
    const window = createWindowMock(), manager = createWindowManagerMock()
    const createWindow = vi.fn(() => window as never)
    const service = createSystemAppWindowService({ createWindow, baseUrl: () => "app://index.html", windowManager: manager })
    await service.open("todos", { todoOpenRequest: { requestId: "first", id: "todo-1" } })
    await service.open("todos", { todoOpenRequest: { requestId: "second", id: "todo-2" } })
    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(new URL(window.loadURL.mock.calls[0]?.[0] as unknown as string).searchParams.get("todoOpenRequest")).toBe(JSON.stringify({ requestId: "first", id: "todo-1" }))
    expect(manager.broadcast).toHaveBeenCalledWith("synapse:app:apps:operation:todo_open_request", { requestId: "second", id: "todo-2" }, expect.any(Function))
    const filter = manager.broadcast.mock.calls[0]?.[2]
    expect(filter?.({ id: window.webContents.id })).toBe(true)
    expect(filter?.({ id: window.webContents.id + 1 })).toBe(false)
  })
  it("keeps mail reading and compose windows separate and focuses a repeated compose intent", async () => {
    const reading = createWindowMock(), composing = createWindowMock(), manager = createWindowManagerMock()
    const createWindow = vi.fn().mockReturnValueOnce(reading).mockReturnValueOnce(composing)
    const service = createSystemAppWindowService({ createWindow, baseUrl: () => "app://index.html", windowManager: manager })
    const request = { requestId: "write-1", ownerId: "owner", generation: 1, compose: { accountId: "account" } }
    await service.open("mail")
    await service.open("mail", { mailOpenRequest: request })
    await service.open("mail", { mailOpenRequest: { ...request, requestId: "write-2" } })
    expect(createWindow).toHaveBeenCalledTimes(2)
    expect(composing.loadURL.mock.calls[0]?.[0]).toContain("mailCompose=1")
    expect(composing.focus).toHaveBeenCalledTimes(1)
    expect(manager.broadcast).not.toHaveBeenCalled()
  })
  it("separates new messages by recipient and reuses only the matching window", async () => {
    const blank = createWindowMock(), first = createWindowMock(), second = createWindowMock()
    first.webContents.id = blank.webContents.id + 1
    second.webContents.id = blank.webContents.id + 2
    const createWindow = vi.fn().mockReturnValueOnce(blank).mockReturnValueOnce(first).mockReturnValueOnce(second)
    const service = createSystemAppWindowService({ createWindow, baseUrl: () => "app://index.html" })
    const scope = { requestId: "new", ownerId: "owner", generation: 1 }
    await service.open("mail", { mailOpenRequest: { ...scope, compose: { accountId: "account" } } })
    for (const address of ["first@example.com", "second@example.com", "first@example.com"]) {
      await service.open("mail", { mailOpenRequest: { ...scope, compose: { accountId: "account", recipient: { address } } } })
    }
    expect(createWindow).toHaveBeenCalledTimes(3)
    expect(first.focus).toHaveBeenCalledTimes(1)
    expect(blank.focus).not.toHaveBeenCalled()
    expect(second.focus).not.toHaveBeenCalled()
    service.bindMailComposeDraft(first.webContents.id, "md_saved_recipient")
    await service.open("mail", { mailOpenRequest: { ...scope, compose: { draftId: "md_saved_recipient" } } })
    expect(createWindow).toHaveBeenCalledTimes(3)
    expect(first.focus).toHaveBeenCalledTimes(2)
  })
  it("reuses a newly saved compose window when opening its draft", async () => {
    const window = createWindowMock(), createWindow = vi.fn(() => window as never)
    const service = createSystemAppWindowService({ createWindow, baseUrl: () => "app://index.html" })
    const scope = { requestId: "new", ownerId: "owner", generation: 1 }
    await service.open("mail", { mailOpenRequest: { ...scope, compose: { accountId: "account" } } })
    service.bindMailComposeDraft(window.webContents.id, "md_saved")
    await service.open("mail", { mailOpenRequest: { ...scope, compose: { draftId: "md_saved" } } })
    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })
  it("keeps the original draft distinct after saving a copy in its window", async () => {
    const first = createWindowMock(), second = createWindowMock()
    second.webContents.id = first.webContents.id + 1
    const createWindow = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    const service = createSystemAppWindowService({ createWindow, baseUrl: () => "app://index.html" })
    const scope = { requestId: "draft", ownerId: "owner", generation: 1 }
    const open = (draftId: string) => service.open("mail", { mailOpenRequest: { ...scope, compose: { draftId } } })
    await open("md_original")
    service.bindMailComposeDraft(first.webContents.id, "md_copy")
    await open("md_original")
    expect(createWindow).toHaveBeenCalledTimes(2)
    await open("md_copy")
    expect(first.focus).toHaveBeenCalledTimes(1)
    expect(second.focus).not.toHaveBeenCalled()
  })
  it("opens and focuses one window per app id", async () => {
    const window = createWindowMock()
    const createWindow = vi.fn(() => window as never)
    const windowManager = createWindowManagerMock()
    const service = createSystemAppWindowService({
      createWindow,
      baseUrl: () => "app://index.html",
      windowManager,
    })

    await service.open("database")
    await service.open("database")

    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(createWindow).toHaveBeenCalledWith(expect.objectContaining({
      title: "Synapse AI Studio 本地数据库",
    }))
    expect(windowManager.attach).toHaveBeenCalledWith(
      { id: "system-app:database", role: "detail" },
      expect.objectContaining({ id: window.webContents.id }),
    )
    expect(window.focus).toHaveBeenCalledTimes(1)
    expect(window.loadURL).toHaveBeenCalledWith("app://index.html?window=system-app&appId=database")
  })

  it("delivers content open requests to an existing resource repository window", async () => {
    const window = createWindowMock()
    const createWindow = vi.fn(() => window as never)
    const windowManager = createWindowManagerMock()
    const service = createSystemAppWindowService({
      createWindow,
      baseUrl: () => "app://index.html",
      windowManager,
    })
    const contentOpenRequest = {
      kind: "detail",
      requestId: "request-1",
      contentType: "skill",
      contentId: "skill-1",
    } as const

    await service.open("resource-repository")
    await service.open("resource-repository", { contentOpenRequest })

    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
    expect(windowManager.broadcast).toHaveBeenCalledWith(
      "synapse:app:apps:operation:content_open_request",
      contentOpenRequest,
      expect.any(Function),
    )
    const filter = windowManager.broadcast.mock.calls[0]?.[2] as BroadcastFilter | undefined
    expect(filter?.({ id: window.webContents.id } as never)).toBe(true)
    expect(filter?.({ id: window.webContents.id + 1 } as never)).toBe(false)
  })

  it("opens and retargets a Git window to a repository", async () => {
    const window = createWindowMock()
    const createWindow = vi.fn(() => window as never)
    const windowManager = createWindowManagerMock()
    const service = createSystemAppWindowService({
      createWindow,
      baseUrl: () => "app://index.html",
      windowManager,
    })
    const firstRequest = { requestId: "request-1", repositoryId: "repository-1" }
    const secondRequest = { requestId: "request-2", repositoryId: "repository-2" }

    await service.open("git", { gitOpenRequest: firstRequest })
    await service.open("git", { gitOpenRequest: secondRequest })

    expect(window.loadURL).toHaveBeenCalledWith(
      expect.stringContaining("appId=git&gitOpenRequest="),
    )
    expect(windowManager.broadcast).toHaveBeenCalledWith(
      "synapse:app:apps:operation:git_open_request",
      secondRequest,
      expect.any(Function),
    )
  })

  it("opens and retargets a Terminal window to a session", async () => {
    const window = createWindowMock()
    const createWindow = vi.fn(() => window as never)
    const windowManager = createWindowManagerMock()
    const service = createSystemAppWindowService({
      createWindow,
      baseUrl: () => "app://index.html",
      windowManager,
    })
    const firstRequest = { requestId: "request-1", sessionId: "session-1" }
    const secondRequest = { requestId: "request-2", sessionId: "session-2" }

    await service.open("terminal", { terminalOpenRequest: firstRequest })
    await service.open("terminal", { terminalOpenRequest: secondRequest })

    expect(window.loadURL).toHaveBeenCalledWith(
      expect.stringContaining("appId=terminal&terminalOpenRequest="),
    )
    expect(windowManager.broadcast).toHaveBeenCalledWith(
      "synapse:app:apps:operation:terminal_open_request",
      secondRequest,
      expect.any(Function),
    )
  })

  it("opens different windows for different app ids", async () => {
    const windows = [createWindowMock(), createWindowMock()]
    const createWindow = vi.fn(() => windows.shift() as never)
    const service = createSystemAppWindowService({ createWindow, baseUrl: () => "app://index.html" })

    await service.open("database")
    await service.open("model-price")

    expect(createWindow).toHaveBeenCalledTimes(2)
    expect(createWindow).toHaveBeenNthCalledWith(1, expect.objectContaining({
      title: "Synapse AI Studio 本地数据库",
    }))
    expect(createWindow).toHaveBeenNthCalledWith(2, expect.objectContaining({
      title: "Synapse AI Studio 价格管理",
    }))
  })

  it("uses windowTitle instead of the launcher name", async () => {
    const window = createWindowMock()
    const createWindow = vi.fn(() => window as never)
    const definition = getSystemAppDefinition("database")!
    const service = createSystemAppWindowService({
      createWindow,
      baseUrl: () => "app://index.html",
      getAppDefinition: () => ({
        ...definition,
        name: "Launcher label",
        windowTitle: "Detached title",
      }),
    })

    await service.open("database")

    expect(createWindow).toHaveBeenCalledWith(expect.objectContaining({
      title: "Synapse AI Studio Detached title",
    }))
  })

  it("rejects apps that do not support detached windows", async () => {
    const createWindow = vi.fn()
    const definition = getSystemAppDefinition("database")!
    const service = createSystemAppWindowService({
      createWindow,
      baseUrl: () => "app://index.html",
      getAppDefinition: () => ({
        ...definition,
        window: { openable: false },
      }),
    })

    await expect(service.open("database")).rejects.toThrow(
      "does not support detached windows",
    )
    expect(createWindow).not.toHaveBeenCalled()
  })

  it("removes closed windows so the app can reopen", async () => {
    const first = createWindowMock()
    const second = createWindowMock()
    const createWindow = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
    const service = createSystemAppWindowService({ createWindow, baseUrl: () => "app://index.html" })

    await service.open("database")
    first.emitClosed()
    await service.open("database")

    expect(createWindow).toHaveBeenCalledTimes(2)
  })

  it("cleans up failed loads so the app can reopen with a fresh window", async () => {
    const first = createWindowMock()
    const second = createWindowMock()
    const createWindow = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
    const windowManager = createWindowManagerMock()
    const service = createSystemAppWindowService({
      createWindow,
      baseUrl: () => "app://index.html",
      windowManager,
    })
    first.loadURL.mockRejectedValueOnce(new Error("renderer unavailable"))

    await expect(service.open("database")).rejects.toThrow("renderer unavailable")
    await service.open("database")

    expect(createWindow).toHaveBeenCalledTimes(2)
    expect(windowManager.detach).toHaveBeenCalledWith("system-app:database")
    expect(first.close).toHaveBeenCalledTimes(1)
    expect(second.loadURL).toHaveBeenCalledWith("app://index.html?window=system-app&appId=database")
  })
})

function createWindowMock() {
  const webContentsId = Math.floor(Math.random() * 10_000) + 1
  let closedHandler: (() => void) | null = null
  return {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    focus: vi.fn(),
    loadURL: vi.fn(async (_url: string) => undefined),
    close: vi.fn(),
    destroy: vi.fn(),
    webContents: {
      id: webContentsId,
      send: vi.fn(),
    },
    on: vi.fn((event: string, handler: () => void) => {
      if (event === "closed") closedHandler = handler
    }),
    emitClosed: () => closedHandler?.(),
  }
}

function createWindowManagerMock() {
  return {
    register: vi.fn(),
    attach: vi.fn(),
    detach: vi.fn(),
    open: vi.fn(),
    close: vi.fn(),
    list: vi.fn(() => []),
    getAllWindows: vi.fn(() => []),
    broadcast: vi.fn((_channel: string, _payload: unknown, _filter?: BroadcastFilter) => 1),
  }
}
