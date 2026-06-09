/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DriveItemDto } from "@synapse/shared"
import type { SynapseAccountState } from "@/types/account"

import { DriveModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  completeDriveUpload: vi.fn(),
  createDriveFolder: vi.fn(),
  deleteDriveItem: vi.fn(),
  disableDriveShare: vi.fn(),
  filePathForDroppedFile: vi.fn(),
  listDriveItems: vi.fn(),
  moveDriveItem: vi.fn(),
  prepareDriveFolderUpload: vi.fn(),
  prepareDriveUpload: vi.fn(),
  renameDriveItem: vi.fn(),
  shareDriveItem: vi.fn(),
  uploadDriveLocalItems: vi.fn(),
  toast: vi.fn(),
  uploadDrivePreparedFile: vi.fn(),
  writeClipboardText: vi.fn(),
}))

const accountState = vi.hoisted((): { current: SynapseAccountState } => ({
  current: {
    status: "authenticated",
    connectivity: "online",
    profile: {
      user: {
        id: "user-1",
        email: "user@example.com",
        status: "active",
        displayName: "Ada",
      },
      teams: [],
      syncedAt: "2026-06-01T00:00:00.000Z",
    },
  },
}))

const accountActions = vi.hoisted(() => ({
  logout: vi.fn(),
  refresh: vi.fn(),
  startLogin: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: mocks.toast,
}))

vi.mock("@/app-shell/account", () => ({
  useAccount: () => ({
    state: accountState.current,
    isLoading: false,
    pendingAction: null,
    startLogin: accountActions.startLogin,
    refresh: accountActions.refresh,
    logout: accountActions.logout,
  }),
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => ({
    account: {
      completeDriveUpload: mocks.completeDriveUpload,
      createDriveFolder: mocks.createDriveFolder,
      deleteDriveItem: mocks.deleteDriveItem,
      disableDriveShare: mocks.disableDriveShare,
      filePathForDroppedFile: mocks.filePathForDroppedFile,
      listDriveItems: mocks.listDriveItems,
      moveDriveItem: mocks.moveDriveItem,
      prepareDriveFolderUpload: mocks.prepareDriveFolderUpload,
      prepareDriveUpload: mocks.prepareDriveUpload,
      renameDriveItem: mocks.renameDriveItem,
      shareDriveItem: mocks.shareDriveItem,
      uploadDriveLocalItems: mocks.uploadDriveLocalItems,
      uploadDrivePreparedFile: mocks.uploadDrivePreparedFile,
    },
  }),
}))

let roots: Root[] = []

beforeEach(() => {
  accountState.current = createAuthenticatedState()
  accountActions.startLogin.mockResolvedValue({ status: "authenticating", loginUrl: "https://example.com/login" })
  accountActions.refresh.mockResolvedValue(accountState.current)
  accountActions.logout.mockResolvedValue({ status: "unauthenticated" })
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.writeClipboardText },
  })
  mocks.completeDriveUpload.mockResolvedValue(createDriveItem({ id: "file-1", name: "report.txt", type: "file", size: "6" }))
  mocks.createDriveFolder.mockResolvedValue(createDriveItem({ id: "folder-1", name: "E2E" }))
  mocks.deleteDriveItem.mockResolvedValue({ ok: true })
  mocks.disableDriveShare.mockResolvedValue({ ok: true })
  mocks.filePathForDroppedFile.mockImplementation((file: File) => `/tmp/${file.name}`)
  mocks.listDriveItems.mockResolvedValue([])
  mocks.moveDriveItem.mockResolvedValue(createDriveItem({ id: "file-1", name: "report.txt", type: "file" }))
  mocks.prepareDriveFolderUpload.mockResolvedValue({
    root: createDriveItem({ id: "folder-root", name: "folder", type: "folder", size: "0" }),
    entries: [],
  })
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
  mocks.uploadDriveLocalItems.mockResolvedValue({ completed: 1, failed: 0, skipped: 0 })
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

  it("shows an account login state without listing drive items when unauthenticated", async () => {
    accountState.current = { status: "unauthenticated" }

    await render(<DriveModule />)
    await flushAct()

    expect(mocks.listDriveItems).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("需要登录账号")
    expect(document.body.textContent).toContain("登录后才能查看云盘。")
    expect(document.body.textContent).not.toContain("synapse:account:drive:items:list")
    expect(getButton("上传文件").disabled).toBe(true)
    expect(getButton("上传文件夹").disabled).toBe(true)
    expect(getButton("新建文件夹").disabled).toBe(true)

    await clickButtonText("登录")

    expect(accountActions.startLogin).toHaveBeenCalledTimes(1)
  })

  it("waits for account login before enabling drive actions", async () => {
    accountState.current = { status: "authenticating", loginUrl: "https://example.com/login" }

    await render(<DriveModule />)
    await flushAct()

    expect(mocks.listDriveItems).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("等待账号登录")
    expect(document.body.textContent).toContain("在浏览器完成登录后会自动刷新。")
    expect(getButton("上传文件").disabled).toBe(true)
    expect(getButton("上传文件夹").disabled).toBe(true)
    expect(getButton("新建文件夹").disabled).toBe(true)
  })

  it("does not expose the ipc channel when a wrapped account error is returned", async () => {
    mocks.listDriveItems.mockRejectedValue(new Error("Error invoking remote method 'synapse:account:drive:items:list': Error: 账号未登录。"))

    await render(<DriveModule />)
    await flushAct()

    expect(document.body.textContent).toContain("需要登录账号")
    expect(document.body.textContent).not.toContain("synapse:account:drive:items:list")
    expect(document.body.textContent).not.toContain("Error invoking remote method")
  })

  it("shows a retry action for ordinary drive load failures", async () => {
    mocks.listDriveItems
      .mockRejectedValueOnce(new Error("云盘列表加载失败。"))
      .mockResolvedValueOnce([])

    await render(<DriveModule />)
    await flushAct()

    expect(document.body.textContent).toContain("云盘加载失败")
    expect(mocks.listDriveItems).toHaveBeenCalledTimes(1)

    await clickButtonText("重试")
    await flushAct()

    expect(mocks.listDriveItems).toHaveBeenCalledTimes(2)
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
    const failedBadge = Array.from(document.querySelectorAll<HTMLElement>("[data-slot='badge']"))
      .find((element) => element.textContent === "上传失败")
    expect(failedBadge?.dataset.variant).toBe("destructive")
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

  it("opens folders from the file table", async () => {
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

  it("keeps the file table stable while opening a folder", async () => {
    let resolveFolderItems: (items: DriveItemDto[]) => void = () => {}
    const folderItems = new Promise<DriveItemDto[]>((resolve) => {
      resolveFolderItems = resolve
    })
    mocks.listDriveItems
      .mockResolvedValueOnce([
        createDriveItem({ id: "file-1", name: "常用.md", type: "file" }),
        createDriveItem({ id: "folder-1", name: "作业范文", type: "folder" }),
      ])
      .mockReturnValueOnce(folderItems)

    await render(<DriveModule />)
    await flushAct()

    await act(async () => {
      getTableRow("作业范文").click()
      await flushPromises()
    })

    expect(mocks.listDriveItems).toHaveBeenLastCalledWith({ parentId: "folder-1" })
    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull()
    expect(document.body.textContent).toContain("常用.md")
    expect(document.querySelector('[aria-current="page"]')?.textContent).toBe("根目录")

    await act(async () => {
      resolveFolderItems([
        createDriveItem({ id: "file-2", name: "cui.md", type: "file", parentId: "folder-1" }),
      ])
      await flushPromises()
    })

    expect(document.body.textContent).toContain("cui.md")
    expect(document.querySelector('[aria-current="page"]')?.textContent).toBe("作业范文")
  })

  it("opens folders when clicking anywhere on the folder row", async () => {
    mocks.listDriveItems
      .mockResolvedValueOnce([
        createDriveItem({ id: "file-1", name: "常用.md", type: "file" }),
        createDriveItem({ id: "folder-1", name: "作业范文", type: "folder" }),
      ])
      .mockResolvedValueOnce([
        createDriveItem({ id: "file-2", name: "cui.md", type: "file", parentId: "folder-1" }),
      ])

    await render(<DriveModule />)
    await flushAct()

    const row = getTableRow("作业范文")
    await act(async () => {
      row.click()
      await flushPromises()
    })
    await flushAct()

    expect(mocks.listDriveItems).toHaveBeenLastCalledWith({ parentId: "folder-1" })
    expect(document.body.textContent).toContain("cui.md")
  })

  it("uses file type icons, table columns, and a grouped breadcrumb trail", async () => {
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
    expect(document.querySelector("table")).not.toBeNull()
    expect(document.body.textContent).toContain("名称")
    expect(document.body.textContent).toContain("状态")
    expect(document.body.textContent).toContain("大小")
    expect(document.body.textContent).toContain("更新时间")

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

  it("uploads selected files through the unified local upload bridge without reading file bodies", async () => {
    await render(<DriveModule />)

    const input = document.querySelector('input[type="file"]:not([webkitdirectory])')
    if (!(input instanceof HTMLInputElement)) throw new Error("File input not found")
    const file = new File(["report"], "report.txt", { type: "text/plain" })
    const arrayBuffer = vi.fn(async () => new TextEncoder().encode("report").buffer)
    Object.defineProperty(file, "arrayBuffer", {
      configurable: true,
      value: arrayBuffer,
    })
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    })

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }))
      await flushPromises()
    })

    expect(mocks.uploadDriveLocalItems).toHaveBeenCalledWith({
      parentId: null,
      items: [{
        kind: "file",
        path: "/tmp/report.txt",
        name: "report.txt",
        mimeType: "text/plain",
      }],
    })
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(mocks.prepareDriveUpload).not.toHaveBeenCalled()
    expect(mocks.uploadDrivePreparedFile).not.toHaveBeenCalled()
    expect(mocks.completeDriveUpload).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith("已上传 1 个文件")
  })

  it("uploads selected files into the current folder", async () => {
    mocks.listDriveItems
      .mockResolvedValueOnce([
        createDriveItem({ id: "folder-1", name: "作业范文", type: "folder" }),
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    await render(<DriveModule />)
    await flushAct()
    await clickText("作业范文")
    await flushAct()

    const input = document.querySelector('input[type="file"]:not([webkitdirectory])')
    if (!(input instanceof HTMLInputElement)) throw new Error("File input not found")
    const file = new File(["nested"], "nested.txt", { type: "text/plain" })
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    })

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }))
      await flushPromises()
    })

    expect(mocks.uploadDriveLocalItems).toHaveBeenCalledWith(expect.objectContaining({
      parentId: "folder-1",
    }))
  })

  it("uploads selected folders through the same local upload bridge", async () => {
    await render(<DriveModule />)

    const input = document.querySelector('input[webkitdirectory]')
    if (!(input instanceof HTMLInputElement)) throw new Error("Folder input not found")
    const first = new File(["alpha"], "a.md", { type: "text/markdown" })
    const second = new File(["beta"], "b.md", { type: "" })
    Object.defineProperty(first, "webkitRelativePath", {
      configurable: true,
      value: "项目A/a.md",
    })
    Object.defineProperty(second, "webkitRelativePath", {
      configurable: true,
      value: "项目A/docs/b.md",
    })
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [first, second],
    })

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }))
      await flushPromises()
    })

    expect(mocks.uploadDriveLocalItems).toHaveBeenCalledWith({
      parentId: null,
      items: [{
        kind: "folder",
        folderName: "项目A",
        files: [
          { path: "/tmp/a.md", relativePath: "a.md", mimeType: "text/markdown" },
          { path: "/tmp/b.md", relativePath: "docs/b.md", mimeType: null },
        ],
      }],
    })
    expect(mocks.prepareDriveFolderUpload).not.toHaveBeenCalled()
    expect(mocks.uploadDrivePreparedFile).not.toHaveBeenCalled()
  })

  it("uploads dropped files through the unified local upload bridge", async () => {
    await render(<DriveModule />)
    await flushAct()

    const dropzone = getDriveDropzone()
    const file = new File(["drop"], "drop.txt", { type: "text/plain" })
    dispatchDragEvent(dropzone, "dragenter", createDataTransfer({ files: [file] }))

    expect(document.body.textContent).toContain("松开上传到 根目录")

    dispatchDragEvent(dropzone, "drop", createDataTransfer({ files: [file] }))
    await flushAct()

    expect(mocks.uploadDriveLocalItems).toHaveBeenCalledWith({
      parentId: null,
      items: [{
        kind: "file",
        path: "/tmp/drop.txt",
        name: "drop.txt",
        mimeType: "text/plain",
      }],
    })
  })

  it("preserves top-level dragged folders and uploads all dropped items", async () => {
    await render(<DriveModule />)
    await flushAct()

    const looseFile = new File(["loose"], "loose.txt", { type: "text/plain" })
    const first = new File(["alpha"], "a.md", { type: "text/markdown" })
    const second = new File(["beta"], "b.md", { type: "" })
    const dropzone = getDriveDropzone()

    dispatchDragEvent(dropzone, "drop", createDataTransfer({
      items: [
        createFileTransferItem(looseFile),
        createDirectoryTransferItem("项目A", [
          createFileEntry("a.md", first),
          createDirectoryEntry("docs", [
            createFileEntry("b.md", second),
          ]),
        ]),
      ],
    }))
    await flushAct()

    expect(mocks.uploadDriveLocalItems).toHaveBeenCalledWith({
      parentId: null,
      items: [
        { kind: "file", path: "/tmp/loose.txt", name: "loose.txt", mimeType: "text/plain" },
        {
          kind: "folder",
          folderName: "项目A",
          files: [
            { path: "/tmp/a.md", relativePath: "a.md", mimeType: "text/markdown" },
            { path: "/tmp/b.md", relativePath: "docs/b.md", mimeType: null },
          ],
        },
      ],
    })
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
    await clickText("移动")

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
    await clickText("移动")

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

function getTableRow(text: string): HTMLTableRowElement {
  const row = Array.from(document.body.querySelectorAll<HTMLTableRowElement>("tbody tr"))
    .find((candidate) => candidate.textContent?.includes(text))
  if (!row) throw new Error(`Table row not found: ${text}`)
  return row
}

function getDriveDropzone(): HTMLElement {
  const dropzone = document.querySelector<HTMLElement>('[data-testid="drive-file-list-dropzone"]')
  if (!dropzone) throw new Error("Drive dropzone not found")
  return dropzone
}

function createDataTransfer({
  files = [],
  items,
}: {
  readonly files?: readonly File[]
  readonly items?: readonly unknown[]
}): DataTransfer {
  return {
    dropEffect: "none",
    files,
    items: items ?? [],
    types: ["Files"],
  } as unknown as DataTransfer
}

function dispatchDragEvent(target: HTMLElement, type: string, dataTransfer: DataTransfer): void {
  act(() => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, "dataTransfer", {
      configurable: true,
      value: dataTransfer,
    })
    target.dispatchEvent(event)
  })
}

function createFileTransferItem(file: File): unknown {
  return {
    webkitGetAsEntry: () => createFileEntry(file.name, file),
  }
}

function createDirectoryTransferItem(name: string, entries: readonly unknown[]): unknown {
  return {
    webkitGetAsEntry: () => createDirectoryEntry(name, entries),
  }
}

function createFileEntry(name: string, file: File): unknown {
  return {
    isDirectory: false,
    isFile: true,
    name,
    file: (success: (nextFile: File) => void) => success(file),
  }
}

function createDirectoryEntry(name: string, entries: readonly unknown[]): unknown {
  let read = false
  return {
    isDirectory: true,
    isFile: false,
    name,
    createReader: () => ({
      readEntries: (success: (nextEntries: unknown[]) => void) => {
        if (read) {
          success([])
          return
        }
        read = true
        success([...entries])
      },
    }),
  }
}

async function openFirstMenu(): Promise<void> {
  await act(async () => {
    const trigger = document.querySelector('button[aria-label^="更多"]')
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

function createAuthenticatedState(): SynapseAccountState {
  return {
    status: "authenticated",
    connectivity: "online",
    profile: {
      user: {
        id: "user-1",
        email: "user@example.com",
        status: "active",
        displayName: "Ada",
      },
      teams: [],
      syncedAt: "2026-06-01T00:00:00.000Z",
    },
  }
}
