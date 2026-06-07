/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DriveItemDto } from "@synapse/shared"

import { DriveModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  completeDriveUpload: vi.fn(),
  createDriveFolder: vi.fn(),
  deleteDriveItem: vi.fn(),
  disableDriveShare: vi.fn(),
  listDriveItems: vi.fn(),
  moveDriveItem: vi.fn(),
  prepareDriveUpload: vi.fn(),
  renameDriveItem: vi.fn(),
  shareDriveItem: vi.fn(),
  toast: vi.fn(),
  uploadDrivePreparedFile: vi.fn(),
  writeClipboardText: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: mocks.toast,
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => ({
    account: {
      completeDriveUpload: mocks.completeDriveUpload,
      createDriveFolder: mocks.createDriveFolder,
      deleteDriveItem: mocks.deleteDriveItem,
      disableDriveShare: mocks.disableDriveShare,
      listDriveItems: mocks.listDriveItems,
      moveDriveItem: mocks.moveDriveItem,
      prepareDriveFolderUpload: vi.fn(),
      prepareDriveUpload: mocks.prepareDriveUpload,
      renameDriveItem: mocks.renameDriveItem,
      shareDriveItem: mocks.shareDriveItem,
      uploadDrivePreparedFile: mocks.uploadDrivePreparedFile,
    },
  }),
}))

let roots: Root[] = []

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.writeClipboardText },
  })
  mocks.completeDriveUpload.mockResolvedValue(createDriveItem({ id: "file-1", name: "report.txt", type: "file", size: "6" }))
  mocks.createDriveFolder.mockResolvedValue(createDriveItem({ id: "folder-1", name: "E2E" }))
  mocks.deleteDriveItem.mockResolvedValue({ ok: true })
  mocks.disableDriveShare.mockResolvedValue({ ok: true })
  mocks.listDriveItems.mockResolvedValue([])
  mocks.moveDriveItem.mockResolvedValue(createDriveItem({ id: "file-1", name: "report.txt", type: "file" }))
  mocks.prepareDriveUpload.mockResolvedValue({
    item: createDriveItem({ id: "file-1", name: "report.txt", type: "file", size: "6" }),
    sessionId: "upload-session-1",
    upload: {
      expiresAt: "2026-06-07T00:15:00.000Z",
      headers: { "Content-Type": "text/plain" },
      method: "PUT",
      url: "https://upload.example.test/object",
    },
  })
  mocks.renameDriveItem.mockResolvedValue(createDriveItem({ id: "file-1", name: "renamed.txt", type: "file" }))
  mocks.shareDriveItem.mockResolvedValue({ id: "share-row-1", shareId: "shr_test", itemId: "file-1", enabled: true, url: "https://synapse.test/files/shr_test", createdAt: "2026-06-07T00:00:00.000Z" })
  mocks.uploadDrivePreparedFile.mockResolvedValue({ ok: true })
  mocks.writeClipboardText.mockResolvedValue(undefined)
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("DriveModule", () => {
  it("renders the cloud drive toolbar actions", () => {
    const html = renderToStaticMarkup(<DriveModule />)

    expect(html).toContain("云盘")
    expect(html).toContain("上传文件")
    expect(html).toContain("上传文件夹")
    expect(html).toContain("新建文件夹")
    expect(html).toContain("刷新")
  })

  it("shows meaningful storage status labels", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "pending-file", name: "pending.txt", type: "file", storageStatus: "pending" }),
      createDriveItem({ id: "failed-file", name: "failed.txt", type: "file", storageStatus: "failed" }),
      createDriveItem({ id: "deleting-file", name: "deleting.txt", type: "file", storageStatus: "delete_pending" }),
      createDriveItem({ id: "shared-file", name: "shared.txt", type: "file", shared: true, activeShareId: "share-row-1" }),
      createDriveItem({ id: "folder-1", name: "folder", type: "folder" }),
    ])

    await render(<DriveModule />)
    await flushAct()

    expect(document.body.textContent).toContain("上传中")
    expect(document.body.textContent).toContain("上传失败")
    expect(document.body.textContent).toContain("删除中")
    expect(document.body.textContent).toContain("已分享")
  })

  it("filters the file list through the compact search input", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", name: "chart_watermark.png", type: "file" }),
      createDriveItem({ id: "folder-1", name: "作业范文", type: "folder" }),
    ])
    await render(<DriveModule />)
    await flushAct()

    const input = document.querySelector('input[aria-label="搜索"]')
    if (!(input instanceof HTMLInputElement)) throw new Error("Search input not found")
    await act(async () => {
      setInputValue(input, "chart")
      input.dispatchEvent(new Event("input", { bubbles: true }))
      await flushPromises()
    })

    expect(document.body.textContent).toContain("chart_watermark.png")
    expect(document.body.textContent).not.toContain("作业范文")
  })

  it("opens folders from the lightweight list", async () => {
    mocks.listDriveItems
      .mockResolvedValueOnce([
        createDriveItem({ id: "folder-1", name: "作业范文", type: "folder" }),
      ])
      .mockResolvedValueOnce([
        createDriveItem({ id: "file-1", name: "cui.md", type: "file", parentId: "folder-1" }),
      ])

    await render(<DriveModule />)
    await flushAct()
    await clickText("作业范文")
    await flushAct()

    expect(mocks.listDriveItems).toHaveBeenLastCalledWith({ parentId: "folder-1" })
    expect(document.body.textContent).toContain("cui.md")
  })

  it("uses file type icons and a grouped breadcrumb trail", async () => {
    mocks.listDriveItems
      .mockResolvedValueOnce([
        createDriveItem({ id: "file-1", name: "2.png", type: "file" }),
        createDriveItem({ id: "folder-1", name: "作业范文", type: "folder" }),
      ])
      .mockResolvedValueOnce([
        createDriveItem({ id: "file-2", name: "cui.md", type: "file", parentId: "folder-1" }),
      ])

    await render(<DriveModule />)
    await flushAct()

    expect(document.querySelector(".lucide-file-text")).not.toBeNull()
    expect(document.querySelector(".lucide-folder")).not.toBeNull()
    expect(document.querySelector('[aria-label="打开文件夹 作业范文"]')).not.toBeNull()

    await clickText("作业范文")
    await flushAct()

    const breadcrumbNav = document.querySelector<HTMLElement>('nav[aria-label="当前位置"]')
    expect(breadcrumbNav).not.toBeNull()
    expect(breadcrumbNav?.className).toContain("h-7")
    expect(breadcrumbNav?.className).toContain("rounded-md")
    expect(breadcrumbNav?.className).toContain("border")
    expect(breadcrumbNav?.querySelector(".lucide-chevron-right")).not.toBeNull()
    expect(breadcrumbNav?.querySelector('[aria-current="page"]')?.textContent).toBe("作业范文")
  })

  it("opens a folder name dialog before creating a folder", async () => {
    await render(<DriveModule />)

    const createButton = getButton("新建文件夹")
    await act(async () => {
      createButton.click()
    })

    expect(document.querySelector('input[aria-label="文件夹名称"]')).not.toBeNull()
    expect(mocks.createDriveFolder).not.toHaveBeenCalled()
  })

  it("uploads selected files through the desktop bridge", async () => {
    await render(<DriveModule />)

    const input = document.querySelector('input[type="file"]:not([webkitdirectory])')
    if (!(input instanceof HTMLInputElement)) throw new Error("File input not found")
    const file = new File(["report"], "report.txt", { type: "text/plain" })
    Object.defineProperty(file, "arrayBuffer", {
      configurable: true,
      value: vi.fn(async () => new TextEncoder().encode("report").buffer),
    })
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    })

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }))
      await flushPromises()
    })

    expect(mocks.prepareDriveUpload).toHaveBeenCalledWith({
      parentId: null,
      name: "report.txt",
      size: "6",
      mimeType: "text/plain",
    })
    expect(mocks.uploadDrivePreparedFile).toHaveBeenCalledWith(expect.objectContaining({
      headers: { "Content-Type": "text/plain" },
      method: "PUT",
      url: "https://upload.example.test/object",
    }))
    expect(mocks.uploadDrivePreparedFile.mock.calls[0]?.[0].body.byteLength).toBe(6)
    expect(mocks.completeDriveUpload).toHaveBeenCalledWith({ sessionId: "upload-session-1" })
    expect(mocks.toast).toHaveBeenCalledWith("已上传 1 个文件")
  })

  it("shows cancel share when a shared item keeps its active share id", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", name: "shared.txt", type: "file", shared: true, activeShareId: "share-row-1" }),
    ])
    await render(<DriveModule />)
    await flushAct()

    await openFirstMenu()
    await clickText("取消分享")

    expect(mocks.disableDriveShare).toHaveBeenCalledWith({ shareId: "share-row-1" })
    expect(mocks.toast).toHaveBeenCalledWith("已取消分享")
  })

  it("shares an item from the row action without opening the more menu", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", name: "report.txt", type: "file" }),
    ])
    await render(<DriveModule />)
    await flushAct()

    await clickButtonText("分享")

    expect(mocks.shareDriveItem).toHaveBeenCalledWith({ itemId: "file-1" })
    expect(mocks.writeClipboardText).toHaveBeenCalledWith("https://synapse.test/files/shr_test")
    expect(mocks.toast).toHaveBeenCalledWith("链接已复制")
  })

  it("keeps rename and move in the more menu without share or delete", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", name: "shared.txt", type: "file", shared: true, activeShareId: "share-row-1" }),
    ])
    await render(<DriveModule />)
    await flushAct()

    await openFirstMenu()

    expect(menuItemTexts()).toEqual(["取消分享", "重命名", "移动"])
  })

  it("opens an in-app confirmation before deleting an item", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", name: "report.txt", type: "file" }),
    ])
    await render(<DriveModule />)
    await flushAct()

    await clickButtonText("删除")

    expect(document.body.textContent).toContain("确认删除")
    expect(document.body.textContent).toContain("report.txt")
    expect(mocks.deleteDriveItem).not.toHaveBeenCalled()

    await clickAlertDialogButton("删除")

    expect(mocks.deleteDriveItem).toHaveBeenCalledWith({ itemId: "file-1" })
    expect(mocks.toast).toHaveBeenCalledWith("已删除")
  })

  it("moves an item to a nested folder selected from the tree", async () => {
    mocks.listDriveItems.mockImplementation(async ({ parentId }: { parentId?: string | null }) => {
      if (parentId === "folder-1") {
        return [
          createDriveItem({ id: "folder-2", name: "二级目录", type: "folder", parentId: "folder-1" }),
          createDriveItem({ id: "file-2", name: "nested.txt", type: "file", parentId: "folder-1" }),
        ]
      }
      return [
        createDriveItem({ id: "file-1", name: "report.txt", type: "file" }),
        createDriveItem({ id: "folder-1", name: "作业范文", type: "folder" }),
      ]
    })
    await render(<DriveModule />)
    await flushAct()

    await openFirstMenu()
    await clickText("移动")
    await flushAct()

    expect(document.body.textContent).toContain("根目录")
    expect(document.body.textContent).toContain("作业范文")

    await clickButtonByLabel("展开 作业范文")
    await flushAct()
    await clickButtonByLabel("选择 二级目录")
    await clickText("确认")

    expect(mocks.moveDriveItem).toHaveBeenCalledWith({ itemId: "file-1", parentId: "folder-2" })
  })

  it("moves an item to the root folder by default", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", name: "report.txt", type: "file" }),
    ])
    await render(<DriveModule />)
    await flushAct()

    await openFirstMenu()
    await clickText("移动")
    await flushAct()
    await clickText("确认")

    expect(mocks.moveDriveItem).toHaveBeenCalledWith({ itemId: "file-1", parentId: null })
  })

  it("disables the moved folder as a tree target", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "folder-1", name: "作业范文", type: "folder" }),
      createDriveItem({ id: "folder-2", name: "归档", type: "folder" }),
    ])
    await render(<DriveModule />)
    await flushAct()

    await openFirstMenu()
    await clickText("移动")
    await flushAct()

    const selfTarget = document.querySelector<HTMLButtonElement>('button[aria-label="选择 作业范文"]')
    expect(selfTarget).not.toBeNull()
    expect(selfTarget?.disabled).toBe(true)
  })

  it("shows a retry action when a folder branch fails to load", async () => {
    let failedOnce = false
    mocks.listDriveItems.mockImplementation(async ({ parentId }: { parentId?: string | null }) => {
      if (parentId === "folder-1") {
        if (!failedOnce) {
          failedOnce = true
          throw new Error("branch failed")
        }
        return [
          createDriveItem({ id: "folder-2", name: "恢复目录", type: "folder", parentId: "folder-1" }),
        ]
      }
      return [
        createDriveItem({ id: "file-1", name: "report.txt", type: "file" }),
        createDriveItem({ id: "folder-1", name: "作业范文", type: "folder" }),
      ]
    })
    await render(<DriveModule />)
    await flushAct()

    await openFirstMenu()
    await clickText("移动")
    await flushAct()
    await clickButtonByLabel("展开 作业范文")
    await flushAct()

    expect(document.body.textContent).toContain("加载失败")

    await clickButtonByLabel("重试 作业范文")
    await flushAct()

    expect(document.body.textContent).toContain("恢复目录")
  })
})

async function render(element: React.ReactNode): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(element)
  })
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function flushAct(): Promise<void> {
  await act(async () => {
    await flushPromises()
  })
}

function getButton(name: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button"))
    .find((element) => element.textContent?.includes(name))
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${name}`)
  return button
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  if (!setter) throw new Error("Input value setter not found")
  setter.call(input, value)
}

function menuItemTexts(): string[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>("[role='menuitem']"))
    .map((element) => element.textContent?.trim() ?? "")
}

async function openFirstMenu(): Promise<void> {
  await act(async () => {
    const trigger = document.querySelector('button[aria-label="更多"]')
    if (!(trigger instanceof HTMLButtonElement)) throw new Error("More menu button not found")
    trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    await flushPromises()
  })
}

async function clickButtonText(text: string): Promise<void> {
  const element = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!element) throw new Error(`Button not found: ${text}`)
  await act(async () => {
    element.click()
    await flushPromises()
  })
}

async function clickAlertDialogButton(text: string): Promise<void> {
  const dialog = document.body.querySelector<HTMLElement>("[role='alertdialog']")
  const element = Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!element) throw new Error(`Alert dialog button not found: ${text}`)
  await act(async () => {
    element.click()
    await flushPromises()
  })
}

async function clickText(text: string): Promise<void> {
  const element = Array.from(document.body.querySelectorAll<HTMLElement>("button, [role='menuitem']"))
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!element) throw new Error(`Element not found: ${text}`)
  await act(async () => {
    element.click()
    await flushPromises()
  })
}

async function clickButtonByLabel(label: string): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!button) throw new Error(`Button not found: ${label}`)
  await act(async () => {
    button.click()
    await flushPromises()
  })
}

function createDriveItem(overrides: Partial<DriveItemDto> = {}): DriveItemDto {
  return {
    activeShareId: null,
    createdAt: "2026-06-07T00:00:00.000Z",
    id: "item-1",
    mimeType: null,
    name: "item",
    parentId: null,
    shared: false,
    size: "0",
    storageStatus: "active" as const,
    type: "folder" as const,
    updatedAt: "2026-06-07T00:00:00.000Z",
    ...overrides,
  }
}
