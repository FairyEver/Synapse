/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  DRIVE_DEFAULT_ACCESS_SETTINGS,
  type DriveItemDto,
  type DrivePublicationDto,
  type DriveShareListItemDto,
} from "@synapse/shared"
import type { SynapseAccountState } from "@/types/account"

import { DriveModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  completeDriveUpload: vi.fn(),
  createDriveFolder: vi.fn(),
  deleteDriveItem: vi.fn(),
  disableDrivePublication: vi.fn(),
  disableDriveShare: vi.fn(),
  filePathForDroppedFile: vi.fn(),
  getDriveDeleteImpact: vi.fn(),
  listDrivePublications: vi.fn(),
  listDriveItems: vi.fn(),
  listDriveShares: vi.fn(),
  moveDriveItem: vi.fn(),
  openExternal: vi.fn(),
  prepareDriveFolderUpload: vi.fn(),
  prepareDriveUpload: vi.fn(),
  publishDrivePage: vi.fn(),
  publishDriveSite: vi.fn(),
  redeployDrivePublication: vi.fn(),
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
      disableDrivePublication: mocks.disableDrivePublication,
      disableDriveShare: mocks.disableDriveShare,
      filePathForDroppedFile: mocks.filePathForDroppedFile,
      getDriveDeleteImpact: mocks.getDriveDeleteImpact,
      listDrivePublications: mocks.listDrivePublications,
      listDriveItems: mocks.listDriveItems,
      listDriveShares: mocks.listDriveShares,
      moveDriveItem: mocks.moveDriveItem,
      prepareDriveFolderUpload: mocks.prepareDriveFolderUpload,
      prepareDriveUpload: mocks.prepareDriveUpload,
      publishDrivePage: mocks.publishDrivePage,
      publishDriveSite: mocks.publishDriveSite,
      redeployDrivePublication: mocks.redeployDrivePublication,
      renameDriveItem: mocks.renameDriveItem,
      shareDriveItem: mocks.shareDriveItem,
      uploadDriveLocalItems: mocks.uploadDriveLocalItems,
      uploadDrivePreparedFile: mocks.uploadDrivePreparedFile,
    },
    shell: {
      openExternal: mocks.openExternal,
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
  mocks.disableDrivePublication.mockResolvedValue({ ok: true })
  mocks.disableDriveShare.mockResolvedValue({ ok: true })
  mocks.filePathForDroppedFile.mockImplementation((file: File) => `/tmp/${file.name}`)
  mocks.getDriveDeleteImpact.mockResolvedValue({ publications: [] })
  mocks.listDrivePublications.mockResolvedValue([])
  mocks.listDriveItems.mockResolvedValue([])
  mocks.listDriveShares.mockResolvedValue([])
  mocks.moveDriveItem.mockResolvedValue(createDriveItem({ id: "file-1", name: "report.txt", type: "file" }))
  mocks.prepareDriveFolderUpload.mockResolvedValue({
    root: createDriveItem({ id: "folder-root", name: "folder", type: "folder", size: "0" }),
    entries: [],
  })
  mocks.openExternal.mockResolvedValue(undefined)
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
  mocks.publishDrivePage.mockResolvedValue(createDrivePublication({ id: "pub-page-1", publishId: "pub_page", name: "report.html", type: "page", url: "https://synapse.test/pages/pub_page" }))
  mocks.publishDriveSite.mockResolvedValue(createDrivePublication({ id: "pub-site-1", publishId: "pub_site", name: "site", type: "site", url: "https://synapse.test/sites/pub_site/" }))
  mocks.redeployDrivePublication.mockResolvedValue(createDrivePublication())
  mocks.renameDriveItem.mockResolvedValue(createDriveItem({ id: "file-1", name: "renamed.txt", type: "file" }))
  mocks.shareDriveItem.mockResolvedValue({
    id: "share-row-1",
    shareId: "shr_test",
    itemId: "file-1",
    enabled: true,
    url: "https://synapse.test/files/shr_test",
    urlWithPassword: "https://synapse.test/files/shr_test?password=AbC234xy",
    passwordEnabled: true,
    password: "AbC234xy",
    expiresAt: "2026-06-14T00:00:00.000Z",
    createdAt: "2026-06-07T00:00:00.000Z",
  })
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
    expect(html).toContain("已分享")
    expect(html).toContain("已发布")
    expect(html).toContain("上传文件")
    expect(html).toContain("上传文件夹")
    expect(html).toContain("新建文件夹")
    expect(html).toContain("刷新")
  })

  it("shows share and publication management actions in the drive top bar", async () => {
    await render(<DriveModule />)
    await flushAct()

    expect(getButton("已分享")).not.toBeNull()
    expect(getButton("已发布")).not.toBeNull()
  })

  it("keeps file actions in the list toolbar after search", () => {
    const html = renderToStaticMarkup(<DriveModule />)

    expect(html.indexOf("搜索")).toBeLessThan(html.indexOf("上传文件"))
    expect(html.indexOf("搜索")).toBeLessThan(html.indexOf("上传文件夹"))
    expect(html.indexOf("搜索")).toBeLessThan(html.indexOf("新建文件夹"))
  })

  it("shows an account login state without listing drive items when unauthenticated", async () => {
    accountState.current = { status: "unauthenticated" }

    await render(<DriveModule />)
    await flushAct()

    expect(mocks.listDriveItems).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("需要登录账号")
    expect(document.body.textContent).toContain("登录后才能查看云盘。")
    expect(document.body.textContent).not.toContain("synapse:account:drive:items:list")
    expect(queryButton("上传文件")).toBeNull()
    expect(queryButton("上传文件夹")).toBeNull()
    expect(queryButton("新建文件夹")).toBeNull()
    expect(getButton("已分享").disabled).toBe(true)
    expect(getButton("已发布").disabled).toBe(true)

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
    expect(queryButton("上传文件")).toBeNull()
    expect(queryButton("上传文件夹")).toBeNull()
    expect(queryButton("新建文件夹")).toBeNull()
    expect(getButton("已分享").disabled).toBe(true)
    expect(getButton("已发布").disabled).toBe(true)
  })

  it("keeps management actions disabled while the drive list is loading", async () => {
    let resolveItems: (items: DriveItemDto[]) => void = () => {}
    mocks.listDriveItems.mockReturnValue(new Promise<DriveItemDto[]>((resolve) => {
      resolveItems = resolve
    }))

    await render(<DriveModule />)
    await flushPromises()

    expect(getButton("已分享").disabled).toBe(true)
    expect(getButton("已发布").disabled).toBe(true)

    await act(async () => {
      resolveItems([])
      await flushPromises()
    })
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

  it("shows share and publication states together in one compact status cell", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({
        activeShareId: "share-row-1",
        id: "html-1",
        mimeType: "text/html",
        name: "report.html",
        shared: true,
        type: "file",
      }),
      createDriveItem({ id: "folder-1", name: "site", type: "folder" }),
    ])
    mocks.listDrivePublications.mockResolvedValue([
      createDrivePublication({ id: "pub-page-1", sourceItemId: "html-1", name: "report.html", type: "page" }),
      createDrivePublication({ id: "pub-site-1", sourceItemId: "folder-1", name: "site", type: "site" }),
    ])

    await render(<DriveModule />)
    await flushAct()

    const reportRow = getTableRow("report.html")
    const reportBadges = Array.from(reportRow.querySelectorAll<HTMLElement>("[data-slot='badge']"))
      .map((element) => element.textContent)
    expect(reportBadges).toEqual(["已发布", "已分享"])
    expect(getTableRow("site").textContent).toContain("已发布")
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

  it("keeps the drive file table fixed, compact, and truncates long names", async () => {
    const longName = "这是一个非常非常非常非常非常非常非常长的文件名-report-2026-final.html"
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", name: longName, size: "1536", type: "file" }),
    ])

    await render(<DriveModule />)
    await flushAct()

    const table = document.querySelector<HTMLTableElement>("table")
    expect(table?.className).toContain("table-fixed")
    expect(table?.className).not.toContain("min-w-[760px]")
    expect(document.body.textContent).toContain("1.5 KB")

    const nameCellText = document.querySelector<HTMLElement>(`td span[title="${longName}"]`)
    expect(nameCellText?.className).toContain("truncate")
    expect(nameCellText?.className).toContain("whitespace-nowrap")
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

  it("keeps non-upload list actions available while a local upload is running", async () => {
    const upload = createDeferred<{ completed: number; failed: number; skipped: number }>()
    mocks.uploadDriveLocalItems.mockReturnValueOnce(upload.promise)
    await render(<DriveModule />)

    const input = document.querySelector('input[type="file"]:not([webkitdirectory])')
    if (!(input instanceof HTMLInputElement)) throw new Error("File input not found")
    const file = new File(["report"], "report.txt", { type: "text/plain" })
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    })

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }))
      await flushPromises()
    })

    expect(document.body.textContent).toContain("正在上传 1 项")
    expect(getButton("上传文件").disabled).toBe(true)
    expect(getButton("新建文件夹").disabled).toBe(false)

    await act(async () => {
      getButton("新建文件夹").click()
      await flushPromises()
    })
    expect(document.querySelector('input[aria-label="文件夹名称"]')).not.toBeNull()

    await act(async () => {
      upload.resolve({ completed: 1, failed: 0, skipped: 0 })
      await flushPromises()
    })
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

  it("refreshes the current folder when upload finishes after navigating during upload", async () => {
    const upload = createDeferred<{ completed: number; failed: number; skipped: number }>()
    mocks.uploadDriveLocalItems.mockReturnValueOnce(upload.promise)
    mocks.listDriveItems
      .mockResolvedValueOnce([
        createDriveItem({ id: "folder-1", name: "作业范文", type: "folder" }),
      ])
      .mockResolvedValueOnce([
        createDriveItem({ id: "nested-before", name: "before.md", type: "file", parentId: "folder-1" }),
      ])
      .mockResolvedValueOnce([
        createDriveItem({ id: "nested-after", name: "after.md", type: "file", parentId: "folder-1" }),
      ])
    await render(<DriveModule />)
    await flushAct()

    const input = document.querySelector('input[type="file"]:not([webkitdirectory])')
    if (!(input instanceof HTMLInputElement)) throw new Error("File input not found")
    const file = new File(["report"], "report.txt", { type: "text/plain" })
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    })
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }))
      await flushPromises()
    })

    await clickText("作业范文")
    await flushAct()

    await act(async () => {
      upload.resolve({ completed: 1, failed: 0, skipped: 0 })
      await flushPromises()
    })

    expect(mocks.listDriveItems).toHaveBeenLastCalledWith({ parentId: "folder-1" })
    expect(document.body.textContent).toContain("after.md")
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

  it("uploads dropped files through the unified local upload bridge into the current folder", async () => {
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

    const dropzone = getDriveDropzone()
    const file = new File(["drop"], "drop.txt", { type: "text/plain" })
    dispatchDragEvent(dropzone, "dragenter", createDataTransfer({ files: [file] }))

    expect(document.body.textContent).toContain("松开上传到 作业范文")

    dispatchDragEvent(dropzone, "drop", createDataTransfer({ files: [file] }))
    await flushAct()

    expect(mocks.uploadDriveLocalItems).toHaveBeenCalledWith({
      parentId: "folder-1",
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

  it("shares a file from the row action and shows the share URL actions", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", name: "report.txt", type: "file" }),
    ])
    await render(<DriveModule />)
    await flushAct()

    await clickButtonText("分享")

    expect(mocks.shareDriveItem).toHaveBeenCalledWith({
      itemId: "file-1",
      ...DRIVE_DEFAULT_ACCESS_SETTINGS,
    })
    expect(mocks.writeClipboardText).toHaveBeenCalledWith("https://synapse.test/files/shr_test")
    expect(mocks.toast).toHaveBeenCalledWith("链接已复制")
    expect(document.body.textContent).toContain("文件已分享")
    expect(getShareUrlInput().value).toBe("https://synapse.test/files/shr_test")

    await clickButtonText("打开文件")
    expect(mocks.openExternal).toHaveBeenCalledWith("https://synapse.test/files/shr_test")

    await clickButtonText("复制链接")
    expect(mocks.writeClipboardText).toHaveBeenLastCalledWith("https://synapse.test/files/shr_test")
    expect(mocks.toast).toHaveBeenCalledWith("链接已复制")
  })

  it("shares a folder from the row action and shows the share URL actions", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "folder-1", name: "site", type: "folder" }),
    ])
    mocks.shareDriveItem.mockResolvedValue({
      id: "share-row-2",
      shareId: "shr_folder",
      itemId: "folder-1",
      enabled: true,
      url: "https://synapse.test/files/shr_folder",
      urlWithPassword: "https://synapse.test/files/shr_folder?password=AbC234xy",
      passwordEnabled: true,
      password: "AbC234xy",
      expiresAt: "2026-06-14T00:00:00.000Z",
      createdAt: "2026-06-07T00:00:00.000Z",
    })
    await render(<DriveModule />)
    await flushAct()

    await clickButtonText("分享")

    expect(mocks.shareDriveItem).toHaveBeenCalledWith({
      itemId: "folder-1",
      ...DRIVE_DEFAULT_ACCESS_SETTINGS,
    })
    expect(mocks.writeClipboardText).toHaveBeenCalledWith("https://synapse.test/files/shr_folder")
    expect(document.body.textContent).toContain("文件夹已分享")
    expect(getShareUrlInput().value).toBe("https://synapse.test/files/shr_folder")

    await clickButtonText("打开文件夹")
    expect(mocks.openExternal).toHaveBeenCalledWith("https://synapse.test/files/shr_folder")
  })

  it("shows the shared URL when automatic clipboard copy fails", async () => {
    mocks.writeClipboardText.mockRejectedValueOnce(new Error("clipboard denied"))
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", name: "report.txt", type: "file" }),
    ])
    await render(<DriveModule />)
    await flushAct()

    await clickButtonText("分享")

    expect(mocks.shareDriveItem).toHaveBeenCalledWith({
      itemId: "file-1",
      ...DRIVE_DEFAULT_ACCESS_SETTINGS,
    })
    expect(mocks.toast).toHaveBeenCalledWith("分享成功，复制失败")
    expect(document.body.textContent).toContain("文件已分享")
    expect(getShareUrlInput().value).toBe("https://synapse.test/files/shr_test")
  })

  it("shows publish page only for html files", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "html-1", name: "report.html", type: "file", mimeType: "text/html" }),
      createDriveItem({ id: "txt-1", name: "notes.txt", type: "file", mimeType: "text/plain" }),
    ])
    await render(<DriveModule />)
    await flushAct()

    await openRowMenu("report.html")
    expect(menuItemTexts()).toContain("发布网页")
    await closeMenus()
    await openRowMenu("notes.txt")
    expect(menuItemTexts()).not.toContain("发布网页")
  })

  it("shows publish site for folders", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "folder-1", name: "site", type: "folder" }),
    ])
    await render(<DriveModule />)
    await flushAct()

    await openRowMenu("site")

    expect(menuItemTexts()).toContain("发布站点")
  })

  it("shows redeploy and cancel publication for active html pages", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "html-1", name: "report.html", type: "file", mimeType: "text/html" }),
    ])
    mocks.listDrivePublications.mockResolvedValue([
      createDrivePublication({ id: "pub-row-1", sourceItemId: "html-1", name: "report.html", type: "page" }),
    ])
    await render(<DriveModule />)
    await flushAct()

    await openRowMenu("report.html")

    expect(menuItemTexts()).toContain("重新发布网页")
    expect(menuItemTexts()).not.toContain("发布网页")
    expect(menuItemTexts()).toContain("取消发布")

    await clickText("取消发布")

    expect(mocks.disableDrivePublication).toHaveBeenCalledWith({ publicationId: "pub-row-1" })
    expect(mocks.toast).toHaveBeenCalledWith("已取消发布")
    expect(mocks.listDriveItems).toHaveBeenCalledTimes(2)
  })

  it("renders row menu items without icons and separates action groups", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({
        id: "html-1",
        name: "report.html",
        type: "file",
        mimeType: "text/html",
        shared: true,
        activeShareId: "share-row-1",
      }),
    ])
    mocks.listDrivePublications.mockResolvedValue([
      createDrivePublication({ id: "pub-row-1", sourceItemId: "html-1", name: "report.html", type: "page" }),
    ])
    await render(<DriveModule />)
    await flushAct()

    await openRowMenu("report.html")

    const menu = document.body.querySelector<HTMLElement>("[role='menu']")
    expect(menu).not.toBeNull()
    expect(menu?.querySelectorAll("[role='menuitem'] svg")).toHaveLength(0)
    expect(menu?.querySelectorAll("[role='separator']").length).toBeGreaterThanOrEqual(2)
    expect(menuItemTexts()).toEqual([
      "重新发布网页",
      "取消发布",
      "取消分享",
      "重命名",
      "移动",
    ])
  })

  it("shows redeploy and cancel publication for active sites", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "folder-1", name: "site", type: "folder" }),
    ])
    mocks.listDrivePublications.mockResolvedValue([
      createDrivePublication({ id: "pub-site-1", sourceItemId: "folder-1", name: "site", type: "site" }),
    ])
    await render(<DriveModule />)
    await flushAct()

    await openRowMenu("site")

    expect(menuItemTexts()).toContain("重新发布站点")
    expect(menuItemTexts()).not.toContain("发布站点")
    expect(menuItemTexts()).toContain("取消发布")
  })

  it("publishes html files and shows the page URL actions", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "html-1", name: "report.html", type: "file", mimeType: "text/html" }),
    ])
    await render(<DriveModule />)
    await flushAct()

    await openRowMenu("report.html")
    await clickText("发布网页")

    expect(mocks.publishDrivePage).toHaveBeenCalledWith({
      itemId: "html-1",
      ...DRIVE_DEFAULT_ACCESS_SETTINGS,
    })
    expect(mocks.writeClipboardText).toHaveBeenCalledWith("https://synapse.test/pages/pub_page")
    expect(mocks.toast).toHaveBeenCalledWith("发布链接已复制")
    expect(document.body.textContent).toContain("网页已发布")
    expect(getPublicationUrlInput().value).toBe("https://synapse.test/pages/pub_page")

    await clickButtonText("打开网页")
    expect(mocks.openExternal).toHaveBeenCalledWith("https://synapse.test/pages/pub_page")

    await clickButtonText("复制链接")
    expect(mocks.writeClipboardText).toHaveBeenLastCalledWith("https://synapse.test/pages/pub_page")
    expect(mocks.toast).toHaveBeenCalledWith("链接已复制")

    expect(mocks.listDriveItems).toHaveBeenCalledTimes(2)
    expect(mocks.listDriveItems).toHaveBeenLastCalledWith({ parentId: null })
    expect(mocks.publishDrivePage.mock.invocationCallOrder[0]).toBeLessThan(mocks.writeClipboardText.mock.invocationCallOrder[0])
    expect(mocks.writeClipboardText.mock.invocationCallOrder[0]).toBeLessThan(mocks.toast.mock.invocationCallOrder[0])
    expect(mocks.toast.mock.invocationCallOrder[0]).toBeLessThan(mocks.listDriveItems.mock.invocationCallOrder[1])
  })

  it("publishes folders and shows the site URL actions", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "folder-1", name: "site", type: "folder" }),
    ])
    await render(<DriveModule />)
    await flushAct()

    await openRowMenu("site")
    await clickText("发布站点")

    expect(mocks.publishDriveSite).toHaveBeenCalledWith({
      itemId: "folder-1",
      ...DRIVE_DEFAULT_ACCESS_SETTINGS,
    })
    expect(mocks.writeClipboardText).toHaveBeenCalledWith("https://synapse.test/sites/pub_site/")
    expect(mocks.toast).toHaveBeenCalledWith("发布链接已复制")
    expect(document.body.textContent).toContain("站点已发布")
    expect(getPublicationUrlInput().value).toBe("https://synapse.test/sites/pub_site/")

    await clickButtonText("打开站点")
    expect(mocks.openExternal).toHaveBeenCalledWith("https://synapse.test/sites/pub_site/")

    expect(mocks.listDriveItems).toHaveBeenCalledTimes(2)
    expect(mocks.listDriveItems).toHaveBeenLastCalledWith({ parentId: null })
    expect(mocks.publishDriveSite.mock.invocationCallOrder[0]).toBeLessThan(mocks.writeClipboardText.mock.invocationCallOrder[0])
    expect(mocks.writeClipboardText.mock.invocationCallOrder[0]).toBeLessThan(mocks.toast.mock.invocationCallOrder[0])
    expect(mocks.toast.mock.invocationCallOrder[0]).toBeLessThan(mocks.listDriveItems.mock.invocationCallOrder[1])
  })

  it("shows the published URL when automatic clipboard copy fails", async () => {
    mocks.writeClipboardText.mockRejectedValueOnce(new Error("clipboard denied"))
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "html-1", name: "report.html", type: "file", mimeType: "text/html" }),
    ])
    await render(<DriveModule />)
    await flushAct()

    await openRowMenu("report.html")
    await clickText("发布网页")

    expect(mocks.publishDrivePage).toHaveBeenCalledWith({
      itemId: "html-1",
      ...DRIVE_DEFAULT_ACCESS_SETTINGS,
    })
    expect(mocks.toast).toHaveBeenCalledWith("发布成功，复制失败")
    expect(document.body.textContent).toContain("网页已发布")
    expect(getPublicationUrlInput().value).toBe("https://synapse.test/pages/pub_page")
    expect(mocks.listDriveItems).toHaveBeenCalledTimes(2)
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

    expect(mocks.getDriveDeleteImpact).toHaveBeenCalledWith({ itemId: "file-1" })
    expect(mocks.deleteDriveItem).toHaveBeenCalledWith({ itemId: "file-1", disablePublications: false })
    expect(mocks.toast).toHaveBeenCalledWith("已删除")
  })

  it("passes disablePublications when the delete checkbox is selected", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", name: "report.html", type: "file", mimeType: "text/html" }),
    ])
    mocks.getDriveDeleteImpact.mockResolvedValue({
      publications: [createDrivePublication({ id: "pub-row-1", name: "report.html", type: "page" })],
    })
    await render(<DriveModule />)
    await flushAct()

    await clickButtonText("删除")
    await flushAct()

    expect(document.body.textContent).toContain("会影响 1 个已发布内容")
    await clickCheckboxByLabel("同时取消相关发布")
    await clickAlertDialogButton("删除")

    expect(mocks.deleteDriveItem).toHaveBeenCalledWith({ itemId: "file-1", disablePublications: true })
  })

  it("manages publications from the publications dialog", async () => {
    mocks.listDrivePublications.mockResolvedValue([
      createDrivePublication({ id: "pub-row-1", name: "report.html", type: "page" }),
      createDrivePublication({ id: "pub-row-2", name: "site", type: "site", publishId: "pub_site", url: "https://synapse.test/sites/pub_site/" }),
      createDrivePublication({ id: "pub-row-3", name: "deleted.html", sourceDeleted: true }),
    ])
    await render(<DriveModule />)
    await flushAct()

    await clickButtonText("已发布")
    await flushAct()

    expect(document.body.textContent).toContain("report.html")
    expect(document.body.textContent).toContain("类型 / 状态")
    expect(document.body.textContent).toContain("来源")
    expect(document.body.textContent).toContain("时间")
    expect(document.body.textContent).toContain("操作")
    expect(document.body.textContent).toContain("网页")
    expect(document.body.textContent).toContain("site")
    expect(document.body.textContent).toContain("站点")
    expect(document.body.textContent).toContain("已发布")
    expect(document.body.textContent).toContain("2026")
    expect(document.body.textContent).toContain("来源正常")
    expect(document.body.textContent).toContain("deleted.html")
    expect(document.body.textContent).toContain("来源已删除")
    expect(queryButtonByLabel("重新发布 deleted.html")).toBeNull()
    expect(queryButtonByLabel("打开 deleted.html")).toBeNull()

    await clickButtonByLabel("复制 report.html")
    expect(mocks.writeClipboardText).toHaveBeenCalledWith("https://synapse.test/pages/pub_test")
    expect(mocks.toast).toHaveBeenCalledWith("链接已复制")

    await clickButtonByLabel("打开 report.html")
    expect(mocks.openExternal).toHaveBeenCalledWith("https://synapse.test/pages/pub_test")

    await clickButtonByLabel("重新发布 report.html")
    expect(mocks.redeployDrivePublication).toHaveBeenCalledWith({ publicationId: "pub-row-1" })
    expect(mocks.toast).toHaveBeenCalledWith("已重新发布")
    expect(document.body.textContent).toContain("网页已发布")
    expect(getPublicationUrlInput().value).toBe("https://synapse.test/pages/pub_test")

    await clickButtonByLabel("取消发布 report.html")

    expect(mocks.listDrivePublications).toHaveBeenCalled()
    expect(mocks.listDrivePublications).toHaveBeenCalledTimes(4)
    expect(mocks.disableDrivePublication).toHaveBeenCalledWith({ publicationId: "pub-row-1" })
    expect(mocks.toast).toHaveBeenCalledWith("已取消发布")
  })

  it("shows publication dialog loading state", async () => {
    const publications = createDeferred<DrivePublicationDto[]>()
    mocks.listDrivePublications.mockReturnValueOnce(publications.promise)
    await render(<DriveModule />)
    await flushAct()

    await clickButtonText("已发布")

    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull()

    await act(async () => {
      publications.resolve([])
      await flushPromises()
    })
  })

  it("shows publication dialog empty state", async () => {
    mocks.listDrivePublications.mockResolvedValue([])
    await render(<DriveModule />)
    await flushAct()

    await clickButtonText("已发布")
    await flushAct()

    expect(document.body.textContent).toContain("暂无发布")
  })

  it("shows publication dialog retry state", async () => {
    mocks.listDrivePublications.mockRejectedValue(new Error("发布列表加载失败。"))
    await render(<DriveModule />)
    await flushAct()

    await clickButtonText("已发布")
    await flushAct()

    expect(document.body.textContent).toContain("读取失败")
    expect(document.body.textContent).toContain("发布列表加载失败。")

    mocks.listDrivePublications.mockReset()
    mocks.listDrivePublications.mockResolvedValue([])

    await clickButtonText("重试")
    await flushAct()
    await flushAct()

    expect(mocks.listDrivePublications).toHaveBeenCalledTimes(1)
  })

  it("manages shares from the shares dialog", async () => {
    mocks.listDriveShares.mockResolvedValue([
      createDriveShare({ id: "share-row-1", shareId: "shr_test", itemName: "report.txt", itemType: "file" }),
      createDriveShare({ id: "share-row-2", shareId: "shr_folder", itemName: "folder", itemType: "folder", sourceDeleted: true, url: "https://synapse.test/files/shr_folder" }),
    ])
    await render(<DriveModule />)
    await flushAct()

    await clickButtonText("已分享")
    await flushAct()

    expect(document.body.textContent).toContain("report.txt")
    expect(document.body.textContent).toContain("类型")
    expect(document.body.textContent).toContain("来源")
    expect(document.body.textContent).toContain("时间")
    expect(document.body.textContent).toContain("操作")
    expect(document.body.textContent).toContain("文件")
    expect(document.body.textContent).toContain("2026")
    expect(document.body.textContent).toContain("来源正常")
    expect(document.body.textContent).toContain("folder")
    expect(document.body.textContent).toContain("文件夹")
    expect(document.body.textContent).toContain("来源已删除")
    expect(queryButtonByLabel("打开 folder")).toBeNull()

    await clickButtonByLabel("复制 report.txt")
    expect(mocks.writeClipboardText).toHaveBeenCalledWith("https://synapse.test/files/shr_test")
    expect(mocks.toast).toHaveBeenCalledWith("链接已复制")

    await clickButtonByLabel("打开 report.txt")
    expect(mocks.openExternal).toHaveBeenCalledWith("https://synapse.test/files/shr_test")

    await clickButtonByLabel("取消分享 report.txt")

    expect(mocks.listDriveShares).toHaveBeenCalled()
    expect(mocks.listDriveShares).toHaveBeenCalledTimes(2)
    expect(mocks.disableDriveShare).toHaveBeenCalledWith({ shareId: "shr_test" })
    expect(mocks.toast).toHaveBeenCalledWith("已取消分享")
  })

  it("shows share dialog loading, empty, and retry states", async () => {
    const shares = createDeferred<DriveShareListItemDto[]>()
    mocks.listDriveShares.mockReturnValueOnce(shares.promise)
    await render(<DriveModule />)
    await flushAct()

    await clickButtonText("已分享")

    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull()

    await act(async () => {
      shares.resolve([])
      await flushPromises()
    })
    await flushAct()

    expect(document.body.textContent).toContain("暂无分享")

    mocks.listDriveShares
      .mockRejectedValueOnce(new Error("分享列表加载失败。"))
      .mockResolvedValueOnce([])

    await clickButtonText("关闭")
    await clickButtonText("已分享")
    await flushAct()

    expect(document.body.textContent).toContain("读取失败")
    expect(document.body.textContent).toContain("分享列表加载失败。")

    await clickButtonText("重试")
    await flushAct()

    expect(mocks.listDriveShares).toHaveBeenCalledTimes(3)
    expect(document.body.textContent).toContain("暂无分享")
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

function createDeferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void; readonly reject: (error: unknown) => void } {
  let resolveDeferred: (value: T) => void = () => {}
  let rejectDeferred: (error: unknown) => void = () => {}
  const promise = new Promise<T>((resolve, reject) => {
    resolveDeferred = resolve
    rejectDeferred = reject
  })
  return { promise, resolve: resolveDeferred, reject: rejectDeferred }
}

async function flushAct(): Promise<void> {
  await act(async () => {
    await flushPromises()
  })
}

function getButton(name: string): HTMLButtonElement {
  const button = queryButton(name)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${name}`)
  return button
}

function queryButton(name: string): HTMLButtonElement | null {
  const button = Array.from(document.querySelectorAll("button"))
    .find((element) => element.textContent?.includes(name))
  return button instanceof HTMLButtonElement ? button : null
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

async function openRowMenu(name: string): Promise<void> {
  await act(async () => {
    const trigger = document.querySelector<HTMLButtonElement>(`button[aria-label="更多 ${name}"]`)
    if (!trigger) throw new Error(`More menu button not found: ${name}`)
    trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    await flushPromises()
  })
}

async function closeMenus(): Promise<void> {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))
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
  const button = queryButtonByLabel(label)
  if (!button) throw new Error(`Button not found: ${label}`)
  await act(async () => {
    button.click()
    await flushPromises()
  })
}

function queryButtonByLabel(label: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
}

function getPublicationUrlInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>("#drive-publication-success-url")
  if (!input) throw new Error("Publication URL input not found")
  return input
}

function getShareUrlInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>("#drive-share-success-url")
  if (!input) throw new Error("Share URL input not found")
  return input
}

async function clickCheckboxByLabel(label: string): Promise<void> {
  const labelElement = Array.from(document.body.querySelectorAll<HTMLLabelElement>("label"))
    .find((candidate) => candidate.textContent?.trim() === label)
  const checkbox = labelElement?.querySelector<HTMLButtonElement>("[role='checkbox']")
  if (!checkbox) throw new Error(`Checkbox not found: ${label}`)
  await act(async () => {
    checkbox.click()
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

function createDrivePublication(overrides: Partial<DrivePublicationDto> = {}): DrivePublicationDto {
  return {
    createdAt: "2026-06-07T00:00:00.000Z",
    currentDeploymentId: "dep-1",
    id: "pub-row-1",
    name: "report.html",
    publishId: "pub_test",
    sourceDeleted: false,
    sourceItemId: "file-1",
    status: "active",
    type: "page",
    updatedAt: "2026-06-07T00:00:00.000Z",
    url: "https://synapse.test/pages/pub_test",
    urlWithPassword: "https://synapse.test/pages/pub_test?password=AbC234xy",
    passwordEnabled: true,
    password: "AbC234xy",
    expiresAt: "2026-06-14T00:00:00.000Z",
    ...overrides,
  }
}

function createDriveShare(overrides: Partial<DriveShareListItemDto> = {}): DriveShareListItemDto {
  return {
    createdAt: "2026-06-07T00:00:00.000Z",
    id: "share-row-1",
    itemId: "file-1",
    itemName: "report.txt",
    itemType: "file",
    shareId: "shr_test",
    sourceDeleted: false,
    url: "https://synapse.test/files/shr_test",
    urlWithPassword: "https://synapse.test/files/shr_test?password=AbC234xy",
    passwordEnabled: true,
    password: "AbC234xy",
    expiresAt: "2026-06-14T00:00:00.000Z",
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
