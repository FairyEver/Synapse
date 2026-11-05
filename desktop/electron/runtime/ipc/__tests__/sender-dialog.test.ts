import { expect, it, vi } from "vitest"
import { showSenderOpenDialog } from "../sender-dialog"

const electron = vi.hoisted(() => {
  const parent = { isDestroyed: vi.fn(() => false) }
  return {
    parent,
    dialog: { showOpenDialog: vi.fn() },
    webContents: { fromId: vi.fn((id) => ({ id })) },
    BrowserWindow: { fromWebContents: vi.fn(() => parent) },
  }
})
vi.mock("electron", () => electron)

it("keeps the picker attached to its sender and discards a result after the sender closes", async () => {
  const sender = { id: 37, isDestroyed: vi.fn(() => false), onDestroyed: vi.fn() }
  electron.dialog.showOpenDialog.mockImplementation(async () => {
    sender.isDestroyed.mockReturnValue(true)
    return { canceled: false, filePaths: ["/tmp/ignored"] }
  })

  await expect(showSenderOpenDialog({ sender }, { properties: ["openDirectory"] }))
    .resolves.toEqual({ canceled: true, filePaths: [] })
  expect(electron.webContents.fromId).toHaveBeenCalledWith(37)
  expect(electron.dialog.showOpenDialog).toHaveBeenCalledWith(electron.parent, { properties: ["openDirectory"] })
  await showSenderOpenDialog({ sender }, { properties: ["openDirectory"] })
  expect(electron.dialog.showOpenDialog).toHaveBeenCalledOnce()
})
