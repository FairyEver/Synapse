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
  type DriveItemListPageDto,
  type DrivePublicAssetDto,
  type DrivePublicAssetListPageDto,
  type DrivePublicLinksPageDto,
  type DriveSiteDto,
  type DriveSiteListPageDto,
  type DriveShareListItemDto,
  type DriveSyncSnapshotDto,
  type DriveTrashListPageDto,
} from "@synapse/shared"
import type { SynapseAccountState } from "@/types/account"
import type { DriveLocalUploadProgressEvent } from "@/types/bridge"
import { DRIVE_LOCAL_UPLOAD_MAX_FILES } from "@/lib/drive-local-upload-limits"

import { DriveModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & {
  ResizeObserver: typeof ResizeObserver
}).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const mocks = vi.hoisted(() => ({
  completeDriveUpload: vi.fn(),
  createDriveFolder: vi.fn(),
  deleteDriveItem: vi.fn(),
  disableDriveShare: vi.fn(),
  filePathForDroppedFile: vi.fn(),
  getDriveItemPreviewUrl: vi.fn(),
  getDriveShare: vi.fn(),
  getDriveSyncSnapshot: vi.fn(),
  getDriveUsage: vi.fn(),
  chooseDriveSyncLocalPath: vi.fn(),
  createDriveSyncSafeBinding: vi.fn(),
  listDrivePublicAssets: vi.fn(),
  listDriveItems: vi.fn(),
  listDriveSites: vi.fn(),
  listDriveTrash: vi.fn(),
  listDriveShares: vi.fn(),
  moveDriveItem: vi.fn(),
  openExternal: vi.fn(),
  prepareDriveFolderUpload: vi.fn(),
  prepareDriveUpload: vi.fn(),
  preflightDriveSite: vi.fn(),
  renameDriveItem: vi.fn(),
  createDriveSite: vi.fn(),
  updateDriveSiteAccess: vi.fn(),
  shareDriveItem: vi.fn(),
  uploadDriveLocalItems: vi.fn(),
  onDriveLocalUploadProgress: vi.fn(),
  toast: vi.fn(),
  toastError: vi.fn(),
  uploadDrivePreparedFile: vi.fn(),
  onDriveSyncChanged: vi.fn(),
  pauseDriveSyncBinding: vi.fn(),
  pollDriveSyncRemoteChanges: vi.fn(),
  previewDriveSyncBinding: vi.fn(),
  removeDriveSyncBinding: vi.fn(),
  rescanDriveSyncBinding: vi.fn(),
  resolveDriveSyncConflict: vi.fn(),
  resumeDriveSyncBinding: vi.fn(),
  updateDriveSyncExcludeRules: vi.fn(),
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
        handle: "ada",
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

let driveUploadProgressListener: ((event: DriveLocalUploadProgressEvent) => void) | null = null

vi.mock("sonner", () => ({
  toast: Object.assign(mocks.toast, { error: mocks.toastError }),
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
      getDriveItemPreviewUrl: mocks.getDriveItemPreviewUrl,
      getDriveShare: mocks.getDriveShare,
      getDriveUsage: mocks.getDriveUsage,
      listDrivePublicAssets: mocks.listDrivePublicAssets,
      listDriveItems: mocks.listDriveItems,
      listDriveSites: mocks.listDriveSites,
      listDriveTrash: mocks.listDriveTrash,
      listDriveShares: mocks.listDriveShares,
      moveDriveItem: mocks.moveDriveItem,
      prepareDriveFolderUpload: mocks.prepareDriveFolderUpload,
      prepareDriveUpload: mocks.prepareDriveUpload,
      preflightDriveSite: mocks.preflightDriveSite,
      renameDriveItem: mocks.renameDriveItem,
      createDriveSite: mocks.createDriveSite,
      updateDriveSiteAccess: mocks.updateDriveSiteAccess,
      shareDriveItem: mocks.shareDriveItem,
      uploadDriveLocalItems: mocks.uploadDriveLocalItems,
      onDriveLocalUploadProgress: mocks.onDriveLocalUploadProgress,
      uploadDrivePreparedFile: mocks.uploadDrivePreparedFile,
    },
    driveSync: {
      chooseLocalPath: mocks.chooseDriveSyncLocalPath,
      createSafeBinding: mocks.createDriveSyncSafeBinding,
      getSnapshot: mocks.getDriveSyncSnapshot,
      onChanged: mocks.onDriveSyncChanged,
      pauseBinding: mocks.pauseDriveSyncBinding,
      pollRemoteChanges: mocks.pollDriveSyncRemoteChanges,
      previewBinding: mocks.previewDriveSyncBinding,
      removeBinding: mocks.removeDriveSyncBinding,
      rescanBinding: mocks.rescanDriveSyncBinding,
      resolveConflict: mocks.resolveDriveSyncConflict,
      resumeBinding: mocks.resumeDriveSyncBinding,
      updateExcludeRules: mocks.updateDriveSyncExcludeRules,
    },
    shell: {
      openExternal: mocks.openExternal,
    },
  }),
}))

let roots: Root[] = []

beforeEach(() => {
  driveUploadProgressListener = null
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
  mocks.getDriveItemPreviewUrl.mockResolvedValue({ url: "https://synapse.test/drive/items/file-1" })
  mocks.getDriveShare.mockResolvedValue(createDriveShare())
  mocks.getDriveSyncSnapshot.mockResolvedValue(createDriveSyncSnapshot())
  mocks.getDriveUsage.mockResolvedValue({ usedBytes: "4", reservedBytes: "0", quotaBytes: "100" })
  mocks.chooseDriveSyncLocalPath.mockResolvedValue("/Users/me/Docs")
  mocks.createDriveSyncSafeBinding.mockResolvedValue(createDriveSyncBinding())
  mocks.listDrivePublicAssets.mockResolvedValue(createDrivePublicAssetPage([]))
  mocks.listDriveItems.mockResolvedValue([])
  mocks.listDriveSites.mockResolvedValue(createDriveSitePage([]))
  mocks.listDriveTrash.mockResolvedValue(createDriveTrashPage([]))
  mocks.listDriveShares.mockResolvedValue(createDrivePublicLinksPage([]))
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
  mocks.preflightDriveSite.mockResolvedValue({
    sourceFolderItemId: "folder-1",
    sourceFolderName: "原型",
    htmlFiles: ["index.html"],
    defaultEntryPath: "index.html",
    fileCount: 3,
    totalBytes: "128",
    includesJavaScript: true,
  })
  mocks.renameDriveItem.mockResolvedValue(createDriveItem({ id: "file-1", name: "renamed.txt", type: "file" }))
  mocks.createDriveSite.mockResolvedValue(createDriveSite())
  mocks.updateDriveSiteAccess.mockResolvedValue(createDriveSite())
  mocks.shareDriveItem.mockResolvedValue({
    id: "share-row-1",
    shareId: "shr_test",
    itemId: "file-1",
    enabled: true,
    url: "https://synapse.test/share/shr_test",
    urlWithPassword: "https://synapse.test/share/shr_test?password=AbC234xy",
    passwordEnabled: true,
    password: "AbC234xy",
    expiresAt: "2026-06-14T00:00:00.000Z",
    accessMode: "link_read",
    editorEmails: [],
    createdAt: "2026-06-07T00:00:00.000Z",
  })
  mocks.uploadDriveLocalItems.mockResolvedValue({ completed: 1, failed: 0, skipped: 0 })
  mocks.onDriveLocalUploadProgress.mockImplementation((listener: (event: DriveLocalUploadProgressEvent) => void) => {
    driveUploadProgressListener = listener
    return () => {
      if (driveUploadProgressListener === listener) driveUploadProgressListener = null
    }
  })
  mocks.uploadDrivePreparedFile.mockResolvedValue({ ok: true })
  mocks.onDriveSyncChanged.mockReturnValue(() => undefined)
  mocks.pauseDriveSyncBinding.mockResolvedValue(undefined)
  mocks.pollDriveSyncRemoteChanges.mockResolvedValue(undefined)
  mocks.previewDriveSyncBinding.mockResolvedValue({
    status: "ready",
    direction: "remote_to_local",
    reason: null,
    localPath: "/Users/me/Docs/report.txt",
    localKind: "missing",
    localEmpty: null,
    forcedExcludeRules: [".git/**", ".git"],
    defaultExcludeRules: [],
    importedGitignoreRules: [],
  })
  mocks.removeDriveSyncBinding.mockResolvedValue(undefined)
  mocks.rescanDriveSyncBinding.mockResolvedValue(undefined)
  mocks.resolveDriveSyncConflict.mockResolvedValue(undefined)
  mocks.resumeDriveSyncBinding.mockResolvedValue(undefined)
  mocks.updateDriveSyncExcludeRules.mockResolvedValue(undefined)
  mocks.writeClipboardText.mockResolvedValue(undefined)
})

afterEach(() => {
  window.getSelection()?.removeAllRanges()
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
    expect(html).toContain("新建")
    expect(html).toContain('aria-label="刷新"')
    expect(html).toContain('aria-label="更多"')
    expect(html).not.toContain("我的分享")
    expect(html).not.toContain("站点")
    expect(html).not.toContain("本地同步")
    expect(html).not.toContain("已分享")
    expect(html).not.toContain("已发布")
    expect(html).not.toContain("上传文件")
    expect(html).not.toContain("上传文件夹")
    expect(html).not.toContain("新建文件夹")
  })

  it("shows fixed public assets and trash entries only at the drive root", async () => {
    mocks.listDriveItems
      .mockResolvedValueOnce([
        createDriveItem({ id: "folder-1", name: "项目资料", type: "folder" }),
      ])
      .mockResolvedValueOnce([
        createDriveItem({ id: "file-1", name: "inside.txt", type: "file", parentId: "folder-1" }),
      ])

    await render(<DriveModule />)
    await flushAct()

    expect(document.body.textContent).toContain("公开素材")
    expect(document.body.textContent).toContain("回收站")

    await clickDriveRow("项目资料")
    await flushAct()

    expect(document.body.textContent).not.toContain("公开素材")
    expect(document.body.textContent).not.toContain("回收站")
    expect(document.body.textContent).toContain("inside.txt")
  })

  it("loads additional drive item pages on demand", async () => {
    mocks.listDriveItems
      .mockResolvedValueOnce(createDriveItemPage(
        [createDriveItem({ id: "file-1", name: "第一页.txt", type: "file" })],
        { offset: 0, limit: 100, hasMore: true, nextOffset: 100 },
      ))
      .mockResolvedValueOnce(createDriveItemPage(
        [createDriveItem({ id: "file-2", name: "第二页.txt", type: "file" })],
        { offset: 100, limit: 100, hasMore: false, nextOffset: null },
      ))

    await render(<DriveModule />)
    await flushAct()

    expect(document.body.textContent).toContain("第一页.txt")
    expect(document.body.textContent).not.toContain("第二页.txt")
    expect(queryExactButton("加载更多")).not.toBeNull()

    await clickButtonText("加载更多")
    await flushAct()

    expect(mocks.listDriveItems).toHaveBeenLastCalledWith({ parentId: null, offset: 100, limit: 100 })
    expect(document.body.textContent).toContain("第一页.txt")
    expect(document.body.textContent).toContain("第二页.txt")
    expect(queryExactButton("加载更多")).toBeNull()
  })

  it("opens system entries without normal drive context actions", async () => {
    await render(<DriveModule />)
    await flushAct()

    await openDriveNameContextMenu("公开素材")
    expect(document.body.querySelector("[role='menu']")).toBeNull()
    expect(queryButtonByLabel("更多 公开素材")).toBeNull()

    await clickDriveRow("公开素材")
    await flushAct()

    expect(mocks.listDrivePublicAssets).toHaveBeenCalledWith({ offset: 0, limit: 50 })
    expect(document.querySelector('[aria-current="page"]')?.textContent).toBe("公开素材")
    expect(queryExactButton("上传")).toBeNull()
    expect(queryButton("新建")).toBeNull()
    expect(queryButton("上传公开素材")).not.toBeNull()
    expect(getButtonByLabel("刷新").querySelector(".lucide-refresh-cw")).not.toBeNull()
  })

  it("uses an icon refresh action in the trash view", async () => {
    await render(<DriveModule />)
    await flushAct()

    await clickDriveRow("回收站")
    await flushAct()

    expect(document.querySelector('[aria-current="page"]')?.textContent).toBe("回收站")
    expect(queryExactButton("刷新")).toBeNull()
    expect(getButtonByLabel("刷新").querySelector(".lucide-refresh-cw")).not.toBeNull()
  })

  it("opens public link management from the top-bar more menu", async () => {
    await render(<DriveModule />)
    await flushAct()

    expect(queryButton("我的分享")).toBeNull()
    expect(queryButton("已分享")).toBeNull()
    expect(queryButton("已发布")).toBeNull()

    await clickDriveToolbarMenuItem("更多", "我的分享")
    await flushAct()

    expect(document.body.textContent).toContain("公开链接")
    const dialogHeader = document.querySelector('[role="dialog"] [data-slot="dialog-frame-header"]')
    if (!dialogHeader) throw new Error("Public links dialog header not found")
    expect(Array.from(dialogHeader.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent)).toEqual([
      "文件",
      "文件夹",
    ])
    expect(document.body.textContent).not.toContain("全部")
    expect(document.body.textContent).toContain("分享")
    expect(document.body.textContent).not.toContain("发布")
  })

  it("shows publish site only for folder rows", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "folder-1", type: "folder", name: "原型" }),
      createDriveItem({ id: "file-1", type: "file", name: "index.html", mimeType: "text/html" }),
    ])

    await render(<DriveModule />)
    await flushAct()

    expect(rowButton("原型", "更多")).toBeTruthy()
    await openRowMenu("原型")
    expect(document.body.textContent).toContain("发布站点")

    await closeMenus()
    await openRowMenu("index.html")
    expect(document.body.textContent).not.toContain("发布站点")
  })

  it("publishes a protected site with generated password output", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "folder-1", type: "folder", name: "原型" }),
    ])
    mocks.createDriveSite.mockResolvedValue(createDriveSite({
      accessMode: "password",
      passwordEnabled: true,
      password: "SitePw1",
      urlWithPassword: "https://synapse.test/sites/site_abc/?password=SitePw1",
      expiresAt: "2026-06-26T00:00:00.000Z",
    }))

    await render(<DriveModule />)
    await flushAct()

    await openRowMenu("原型")
    await clickText("发布站点")

    expect(document.querySelector<HTMLInputElement>("#drive-site-password")).toBeNull()
    expect(document.body.textContent).toContain("需要密码")
    expect(document.body.textContent).toContain("3 天")

    await clickButtonText("发布")

    expect(mocks.createDriveSite).toHaveBeenCalledWith({
      sourceFolderItemId: "folder-1",
      name: "原型",
      entryPath: "index.html",
      accessMode: "password",
      expiresIn: "3d",
    })
    expect(getSiteCreatedUrlInput().value).toBe("https://synapse.test/sites/site_abc/?password=SitePw1")
    expect(getSiteCreatedPasswordInput().value).toBe("SitePw1")

    await clickButtonText("复制链接")
    expect(mocks.writeClipboardText).toHaveBeenLastCalledWith("https://synapse.test/sites/site_abc/?password=SitePw1")

    await clickButtonByLabel("复制密码")
    expect(mocks.writeClipboardText).toHaveBeenLastCalledWith("SitePw1")
  })

  it("shows publish progress copy while a site is being created", async () => {
    const createSite = createDeferred<DriveSiteDto>()
    mocks.preflightDriveSite.mockResolvedValueOnce({
      sourceFolderItemId: "folder-1",
      sourceFolderName: "dist",
      htmlFiles: ["index.html"],
      defaultEntryPath: "index.html",
      fileCount: 90,
      totalBytes: "4928307",
      includesJavaScript: true,
    })
    mocks.createDriveSite.mockReturnValueOnce(createSite.promise)
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "folder-1", type: "folder", name: "dist" }),
    ])

    await render(<DriveModule />)
    await flushAct()

    await openRowMenu("dist")
    await clickText("发布站点")
    await clickButtonText("发布")

    const submitButton = getButton("发布中")
    expect(submitButton.disabled).toBe(true)

    await hoverElement(submitButton.parentElement ?? submitButton)

    expect(document.body.textContent).toContain("正在复制 90 个文件")

    await act(async () => {
      createSite.resolve(createDriveSite())
      await flushPromises()
    })
  })

  it("shows bundled site guidance for JavaScript site folders", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "folder-1", type: "folder", name: "dist" }),
    ])

    await render(<DriveModule />)
    await flushAct()

    await openRowMenu("dist")
    await clickText("发布站点")

    expect(document.body.textContent).toContain("打包站点需要相对路径")
    expect(getButton("查看设置")).not.toBeNull()

    await clickButtonText("查看设置")

    expect(document.body.textContent).toContain("Vite")
    expect(document.body.textContent).toContain("base: './'")
    expect(document.body.textContent).toContain("hash 路由")
    expect(document.body.textContent).toContain("上传 dist 里的内容")

    await clickButtonText("复制")

    expect(mocks.writeClipboardText).toHaveBeenLastCalledWith(expect.stringContaining("base: './'"))
    expect(mocks.writeClipboardText).toHaveBeenLastCalledWith(expect.stringContaining("dist/index.html"))
    expect(mocks.toast).toHaveBeenLastCalledWith("已复制")
  })

  it("does not show bundled site guidance for plain HTML site folders", async () => {
    mocks.preflightDriveSite.mockResolvedValueOnce({
      sourceFolderItemId: "folder-1",
      sourceFolderName: "原型",
      htmlFiles: ["index.html"],
      defaultEntryPath: "index.html",
      fileCount: 1,
      totalBytes: "64",
      includesJavaScript: false,
    })
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "folder-1", type: "folder", name: "原型" }),
    ])

    await render(<DriveModule />)
    await flushAct()

    await openRowMenu("原型")
    await clickText("发布站点")

    expect(document.body.textContent).not.toContain("打包站点需要相对路径")
    expect(queryButton("查看设置")).toBeNull()
  })

  it("opens the site management dialog from the Drive top bar", async () => {
    mocks.listDriveSites.mockResolvedValue(createDriveSitePage([
      createDriveSite({
        name: "001",
        accessMode: "password",
        expiresIn: "3d",
        expiresAt: "2026-06-26T06:04:00.000Z",
        totalBytes: "26522",
        url: "https://synapse.d2.pub/sites/site_AZYoLz4O/",
        urlWithPassword: "https://synapse.d2.pub/sites/site_AZYoLz4O/?password=SitePw1",
      }),
    ]))

    await render(<DriveModule />)
    await flushAct()

    await clickDriveToolbarMenuItem("更多", "站点")
    await flushAct()

    const dialog = document.querySelector('[role="dialog"]')
    if (!dialog) throw new Error("Site management dialog not found")
    expect(dialog.textContent).toContain("站点")
    expect(dialog.className).toContain("w-[calc(100%-2rem)]")
    expect(mocks.listDriveSites).toHaveBeenCalledWith({ offset: 0, limit: 50 })
    expect(tableColumnClasses(dialog)).toEqual(["w-80", "w-20", "w-20", "w-32", "w-32", "w-24", "w-32"])
    expect(dialog.textContent).toContain("001")
    expect(dialog.textContent).toContain("https://synapse.d2.pub/sites/site_AZYoLz4O/")
    expect(dialog.textContent).toContain("正常")
    expect(dialog.textContent).toContain("密码")
    expect(dialog.textContent).toContain("25.9 KB")
    expect(queryButtonByLabel("复制 001")).not.toBeNull()
    expect(queryButtonByLabel("打开 001")).not.toBeNull()
  })

  it("preserves the current site expiration option when saving access settings", async () => {
    mocks.listDriveSites.mockResolvedValue(createDriveSitePage([
      createDriveSite({
        name: "001",
        accessMode: "password",
        passwordEnabled: true,
        expiresIn: "1y",
        expiresAt: "2027-06-23T00:00:00.000Z",
      }),
    ]))

    await render(<DriveModule />)
    await flushAct()

    await clickDriveToolbarMenuItem("更多", "站点")
    await flushAct()
    await openRowMenu("001")
    await clickText("访问设置")
    await clickButtonText("保存")

    expect(mocks.updateDriveSiteAccess).toHaveBeenCalledWith({
      siteId: "site_abc",
      accessMode: "password",
      expiresIn: "1y",
    })
  })

  it("groups cloud drive actions in the top toolbar", async () => {
    await render(<DriveModule />)
    await flushAct()

    expect(driveToolbarActionLabels()).toEqual(["同步状态：暂无同步绑定", "新建", "刷新", "更多"])
    expect(getButtonByLabel("刷新").querySelector(".lucide-refresh-cw")).not.toBeNull()
    expect(getButtonByLabel("更多").querySelector(".lucide-ellipsis")).not.toBeNull()
  })

  it("orders create actions in one top-bar menu", async () => {
    await render(<DriveModule />)
    await flushAct()

    await openDriveToolbarMenu("新建")

    expect(menuItemTexts()).toEqual(["新建文件夹", "上传文件", "上传文件夹"])
  })

  it("orders management actions in the top-bar more menu", async () => {
    await render(<DriveModule />)
    await flushAct()

    await openDriveToolbarMenu("更多")

    expect(menuItemTexts()).toEqual(["本地同步", "我的分享", "站点"])
  })

  it("shows drive sync conflicts in the top toolbar", async () => {
    mocks.getDriveSyncSnapshot.mockResolvedValue(createDriveSyncSnapshot(
      { conflictCount: 2 },
      {
        bindings: [
          createDriveSyncBinding({ id: "binding-1" }),
          createDriveSyncBinding({ id: "binding-2" }),
        ],
        conflicts: [
          {
            id: "conflict-1",
            bindingId: "binding-1",
            relativePath: "spec.md",
            type: "both_modified",
            createdAt: "2026-06-28T00:00:00.000Z",
          },
          {
            id: "conflict-2",
            bindingId: "binding-2",
            relativePath: "notes.md",
            type: "both_modified",
            createdAt: "2026-06-28T00:00:00.000Z",
          },
        ],
      },
    ))

    await render(<DriveModule />)
    await flushAct()

    expect(mocks.getDriveSyncSnapshot).toHaveBeenCalledTimes(1)
    const button = getButtonByLabel("同步状态：2 个冲突")
    expect(button.dataset.variant).toBe("ghost")
    expect(button.className).toContain("text-destructive")
    expect(button.querySelector<HTMLElement>("[data-slot='badge']")?.dataset.variant).toBe("destructive")
    expect(button.textContent).toContain("同步")
    expect(button.textContent).toContain("2")
  })

  it("ignores orphan drive sync conflicts in the top toolbar", async () => {
    mocks.getDriveSyncSnapshot.mockResolvedValue(createDriveSyncSnapshot(
      { conflictCount: 1 },
      {
        conflicts: [{
          id: "orphan-conflict",
          bindingId: "removed-binding",
          relativePath: "spec.md",
          type: "both_modified",
          createdAt: "2026-06-28T00:00:00.000Z",
        }],
      },
    ))

    await render(<DriveModule />)
    await flushAct()

    const button = getButtonByLabel("同步状态：暂无同步绑定")
    expect(button.dataset.variant).toBe("ghost")
    expect(button.querySelector<HTMLElement>("[data-slot='badge']")).toBeNull()
    expect(queryButtonByLabel("同步状态：1 个冲突")).toBeNull()
  })

  it("shows paused-only drive sync bindings in the top toolbar", async () => {
    mocks.getDriveSyncSnapshot.mockResolvedValue(createDriveSyncSnapshot(
      { activeBindingCount: 0 },
      { bindings: [createDriveSyncBinding({ id: "binding-paused", driveItemName: "Paused", status: "paused" })] },
    ))

    await render(<DriveModule />)
    await flushAct()

    const button = getButtonByLabel("同步状态：1 个暂停")
    expect(button.dataset.variant).toBe("ghost")
    expect(button.querySelector<HTMLElement>("[data-slot='badge']")?.dataset.variant).toBe("secondary")
    expect(queryButtonByLabel("同步状态：暂无同步绑定")).toBeNull()
  })

  it("shows drive sync errors as a recoverable badge", async () => {
    mocks.getDriveSyncSnapshot.mockResolvedValue(createDriveSyncSnapshot(
      { errorCount: 11 },
      { bindings: [createDriveSyncBinding({ status: "error", lastError: "本地文件不存在" })] },
    ))

    await render(<DriveModule />)
    await flushAct()

    const button = getButtonByLabel("同步状态：11 个错误")
    expect(button.dataset.variant).toBe("ghost")
    expect(button.querySelector<HTMLElement>("[data-slot='badge']")?.dataset.variant).toBe("outline")
    expect(button.querySelector("svg")).toBeNull()
    expect(button.textContent).toContain("同步")
    expect(button.textContent).toContain("11")

    await clickButtonByLabel("同步状态：11 个错误")
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("错误")
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("本地文件不存在")
    expect(getButton("重试同步")).toBeTruthy()
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("恢复")
  })

  it("shows background drive sync health errors in the top toolbar", async () => {
    mocks.getDriveSyncSnapshot.mockResolvedValue(createDriveSyncSnapshot(
      { activeBindingCount: 1 },
      {
        bindings: [createDriveSyncBinding()],
        health: {
          status: "error",
          lastError: "network unavailable",
          updatedAt: "2026-06-28T00:00:00.000Z",
        },
      },
    ))

    await render(<DriveModule />)
    await flushAct()

    const button = getButtonByLabel("同步状态：1 个错误")
    expect(button.dataset.variant).toBe("ghost")
    expect(button.querySelector<HTMLElement>("[data-slot='badge']")?.dataset.variant).toBe("outline")
    expect(button.textContent).toContain("1")
  })

  it("shows active bindings with open conflicts in the conflict tab", async () => {
    mocks.getDriveSyncSnapshot.mockResolvedValue(createDriveSyncSnapshot(
      { activeBindingCount: 1, conflictCount: 1 },
      {
        bindings: [createDriveSyncBinding({ id: "binding-active", driveItemName: "Active", status: "active" })],
        conflicts: [{
          id: "conflict-1",
          bindingId: "binding-active",
          relativePath: "spec.md",
          type: "both_modified",
          createdAt: "2026-06-28T00:00:00.000Z",
        }],
      },
    ))

    await render(<DriveModule />)
    await flushAct()
    await clickButtonByLabel("同步状态：1 个冲突")
    await clickTabText("有冲突")

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Active")
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("1 个冲突")
  })

  it("opens the drive sync status dialog from the toolbar", async () => {
    mocks.getDriveSyncSnapshot.mockResolvedValue(createDriveSyncSnapshot(
      { activeBindingCount: 1, conflictCount: 1 },
      {
        bindings: [createDriveSyncBinding()],
        conflicts: [{
          id: "conflict-1",
          bindingId: "binding-1",
          relativePath: "spec.md",
          type: "both_modified",
          createdAt: "2026-06-28T00:00:00.000Z",
        }],
        operations: [{
          id: "operation-1",
          bindingId: "binding-1",
          kind: "download",
          relativePath: "spec.md",
          status: "succeeded",
          message: null,
          updatedAt: "2026-06-28T00:00:00.000Z",
        }],
      },
    ))

    await render(<DriveModule />)
    await flushAct()
    await clickButtonByLabel("同步状态：1 个冲突")

    const dialog = document.querySelector('[role="dialog"]')
    if (!dialog) throw new Error("Drive sync dialog not found")
    const dialogContent = document.querySelector('[data-slot="dialog-content"]')
    expect(dialogContent?.className).toContain("sm:max-w-4xl")
    expect(dialogContent?.className).toContain("h-[36rem]")
    expect(dialog.textContent).toContain("同步状态")
    const dialogHeader = dialog.querySelector('[data-slot="dialog-frame-header"]')
    if (!dialogHeader) throw new Error("Drive sync dialog header not found")
    expect(Array.from(dialogHeader.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent)).toEqual([
      "全部",
      "已启用",
      "有冲突",
      "已暂停",
      "错误",
    ])
    expect(dialog.textContent).toContain("Docs")
    expect(dialog.textContent).toContain("/Users/me/Docs")
    expect(dialog.textContent).toContain("已启用")
    expect(dialog.textContent).not.toContain("同步中")
    expect(dialog.textContent).toContain("1 个冲突")
    expect(dialog.textContent).toContain("1 条同步记录")
    expect(dialog.textContent).not.toContain("排除规则")
    expect(dialog.textContent).not.toContain("spec.md")
  })

  it("opens drive sync binding details with scoped conflicts and operations", async () => {
    mocks.getDriveSyncSnapshot.mockResolvedValue(createDriveSyncSnapshot(
      { activeBindingCount: 2, conflictCount: 2 },
      {
        bindings: [
          createDriveSyncBinding({ id: "binding-1", driveItemName: "Docs", localPath: "/Users/me/Docs" }),
          createDriveSyncBinding({ id: "binding-2", driveItemName: "Notes", localPath: "/Users/me/Notes" }),
        ],
        conflicts: [
          {
            id: "conflict-1",
            bindingId: "binding-1",
            relativePath: "docs-conflict.md",
            type: "both_modified",
            createdAt: "2026-06-28T00:00:00.000Z",
          },
          {
            id: "conflict-2",
            bindingId: "binding-2",
            relativePath: "notes-conflict.md",
            type: "both_modified",
            createdAt: "2026-06-28T00:00:00.000Z",
          },
        ],
        operations: [
          {
            id: "operation-1",
            bindingId: "binding-1",
            kind: "upload",
            relativePath: "docs-operation.md",
            status: "succeeded",
            message: null,
            updatedAt: "2026-06-28T00:00:00.000Z",
          },
          {
            id: "operation-2",
            bindingId: "binding-2",
            kind: "download",
            relativePath: "notes-operation.md",
            status: "succeeded",
            message: null,
            updatedAt: "2026-06-28T00:00:00.000Z",
          },
        ],
      },
    ))

    await render(<DriveModule />)
    await flushAct()
    await clickButtonByLabel("同步状态：2 个冲突")
    await clickButtonByLabel("处理同步冲突 Docs")

    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
    const detailDialog = dialogs.find((candidate) => candidate.textContent?.includes("排除规则"))
    if (!detailDialog) throw new Error("Drive sync detail dialog not found")
    expect(detailDialog.textContent).toContain("排除规则")
    expect(detailDialog.textContent).toContain("处理冲突")
    expect(detailDialog.textContent).toContain("同步记录")
    expect(detailDialog.textContent).toContain("docs-conflict.md")
    expect(detailDialog.textContent).toContain("docs-operation.md")
    expect(detailDialog.textContent).toContain("上传")
    expect(detailDialog.textContent).not.toContain("notes-conflict.md")
    expect(detailDialog.textContent).not.toContain("notes-operation.md")
  })

  it("offers confirm delete for delete-modify drive sync conflicts", async () => {
    mocks.getDriveSyncSnapshot.mockResolvedValue(createDriveSyncSnapshot(
      { activeBindingCount: 1, conflictCount: 2 },
      {
        bindings: [createDriveSyncBinding({ status: "conflict" })],
        conflicts: [
          {
            id: "conflict-delete",
            bindingId: "binding-1",
            relativePath: "deleted-spec.md",
            type: "delete_vs_modify",
            createdAt: "2026-06-28T00:00:00.000Z",
          },
          {
            id: "conflict-edit",
            bindingId: "binding-1",
            relativePath: "edited-spec.md",
            type: "both_modified",
            createdAt: "2026-06-28T00:00:00.000Z",
          },
        ],
      },
    ))

    await render(<DriveModule />)
    await flushAct()
    await clickButtonByLabel("同步状态：2 个冲突")
    await clickButtonByLabel("处理同步冲突 Docs")

    expect(rowButtonTexts("deleted-spec.md")).toEqual(["确认删除", "稍后"])
    expect(rowButtonTexts("edited-spec.md")).toEqual(["用本地", "用云端", "保留两份", "稍后"])

    await clickRowButtonText("deleted-spec.md", "确认删除")

    expect(mocks.resolveDriveSyncConflict).toHaveBeenCalledWith({
      conflictId: "conflict-delete",
      action: "confirm_delete",
    })
  })

  it("hides keep-both for folder-backed drive sync conflicts", async () => {
    mocks.getDriveSyncSnapshot.mockResolvedValue(createDriveSyncSnapshot(
      { activeBindingCount: 1, conflictCount: 1 },
      {
        bindings: [createDriveSyncBinding({ status: "conflict" })],
        conflicts: [{
          id: "folder-conflict",
          bindingId: "binding-1",
          relativePath: "docs",
          type: "both_modified",
          availableActions: ["keep_local", "keep_remote", "skip"],
          createdAt: "2026-06-28T00:00:00.000Z",
        }],
      },
    ))

    await render(<DriveModule />)
    await flushAct()
    await clickButtonByLabel("同步状态：1 个冲突")
    await clickButtonByLabel("处理同步冲突 Docs")

    expect(rowButtonTexts("docs")).toEqual(["用本地", "用云端", "稍后"])
  })

  it("keeps the drive sync detail close button inside the dialog header", async () => {
    mocks.getDriveSyncSnapshot.mockResolvedValue(createDriveSyncSnapshot(
      { activeBindingCount: 1 },
      { bindings: [createDriveSyncBinding()] },
    ))

    await render(<DriveModule />)
    await flushAct()
    await clickButtonByLabel("同步状态：1 个绑定")
    await clickButtonByLabel("查看同步详情 Docs")

    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
    const detailDialog = dialogs.find((candidate) => candidate.textContent?.includes("排除规则"))
    if (!detailDialog) throw new Error("Drive sync detail dialog not found")
    const detailHeader = detailDialog.querySelector('[data-slot="dialog-frame-header"]')
    if (!detailHeader) throw new Error("Drive sync detail header not found")
    const closeButton = Array.from(detailHeader.querySelectorAll<HTMLButtonElement>('button[data-slot="dialog-close"]'))
      .find((button) => button.textContent?.includes("关闭"))

    expect(closeButton).toBeTruthy()
    expect(closeButton?.className).not.toContain("absolute")
  })

  it("groups secondary drive sync actions behind a menu and confirms stopping sync", async () => {
    mocks.getDriveSyncSnapshot.mockResolvedValue(createDriveSyncSnapshot(
      { activeBindingCount: 1 },
      { bindings: [createDriveSyncBinding({ driveItemName: "Docs", drivePathHint: "/Projects/Docs" })] },
    ))

    await render(<DriveModule />)
    await flushAct()
    await clickButtonByLabel("同步状态：1 个绑定")

    expect(getButtonByLabel("查看同步详情 Docs")).toBeTruthy()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("云端 /Projects/Docs")
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("本地 /Users/me/Docs")
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("检查本地变更")

    await clickButtonByLabel("更多同步操作 Docs")
    expect(document.body.textContent).toContain("检查本地变更")
    expect(document.body.textContent).toContain("同步云端变更")
    expect(document.body.textContent).toContain("暂停同步")
    expect(document.body.textContent).toContain("停止同步")

    await clickMenuItemText("停止同步")
    expect(document.body.textContent).toContain("停止同步 Docs")
    expect(document.body.textContent).toContain("不会删除本地或云端文件，只会取消这条同步关系。")
    expect(mocks.removeDriveSyncBinding).not.toHaveBeenCalled()

    await clickAlertDialogButton("停止同步")
    expect(mocks.removeDriveSyncBinding).toHaveBeenCalledWith({ id: "binding-1" })
  })

  it("disables manual sync checks for paused bindings", async () => {
    mocks.getDriveSyncSnapshot.mockResolvedValue(createDriveSyncSnapshot(
      { activeBindingCount: 0 },
      { bindings: [createDriveSyncBinding({ driveItemName: "Docs", status: "paused" })] },
    ))

    await render(<DriveModule />)
    await flushAct()
    await clickButtonByLabel("同步状态：1 个暂停")
    await clickButtonByLabel("更多同步操作 Docs")

    const menuItems = Array.from(document.body.querySelectorAll<HTMLElement>("[role='menuitem']"))
    const localSync = menuItems.find((item) => item.textContent?.trim() === "检查本地变更")
    const remoteSync = menuItems.find((item) => item.textContent?.trim() === "同步云端变更")

    expect(localSync?.getAttribute("aria-disabled")).toBe("true")
    expect(remoteSync?.getAttribute("aria-disabled")).toBe("true")
    expect(mocks.rescanDriveSyncBinding).not.toHaveBeenCalled()
    expect(mocks.pollDriveSyncRemoteChanges).not.toHaveBeenCalled()
  })

  it("disables binding sync actions while an action is running", async () => {
    const rescan = createDeferred<void>()
    mocks.getDriveSyncSnapshot
      .mockResolvedValueOnce(createDriveSyncSnapshot(
        { activeBindingCount: 1 },
        { bindings: [createDriveSyncBinding({ driveItemName: "Docs" })] },
      ))
      .mockResolvedValueOnce(createDriveSyncSnapshot(
        { activeBindingCount: 1 },
        { bindings: [createDriveSyncBinding({ driveItemName: "Docs" })] },
      ))
    mocks.rescanDriveSyncBinding.mockReturnValueOnce(rescan.promise)

    await render(<DriveModule />)
    await flushAct()
    await clickButtonByLabel("同步状态：1 个绑定")
    await clickButtonByLabel("更多同步操作 Docs")
    await clickMenuItemText("检查本地变更")

    expect(mocks.rescanDriveSyncBinding).toHaveBeenCalledTimes(1)
    expect(getButtonByLabel("查看同步详情 Docs").disabled).toBe(true)
    expect(getButtonByLabel("更多同步操作 Docs").disabled).toBe(true)

    await act(async () => {
      rescan.resolve(undefined)
      await flushPromises()
    })
    await flushAct()

    expect(mocks.getDriveSyncSnapshot).toHaveBeenCalledTimes(2)
    expect(getButtonByLabel("查看同步详情 Docs").disabled).toBe(false)
    expect(getButtonByLabel("更多同步操作 Docs").disabled).toBe(false)
  })

  it("refreshes the sync snapshot after failed secondary sync actions", async () => {
    mocks.getDriveSyncSnapshot
      .mockResolvedValueOnce(createDriveSyncSnapshot(
        { activeBindingCount: 1 },
        { bindings: [createDriveSyncBinding({ driveItemName: "Docs" })] },
      ))
      .mockResolvedValueOnce(createDriveSyncSnapshot(
        { errorCount: 1 },
        { bindings: [createDriveSyncBinding({ driveItemName: "Docs", status: "error", lastError: "本地路径不存在。" })] },
      ))
    mocks.rescanDriveSyncBinding.mockRejectedValueOnce(new Error("本地路径不存在。"))

    await render(<DriveModule />)
    await flushAct()
    await clickButtonByLabel("同步状态：1 个绑定")
    await clickButtonByLabel("更多同步操作 Docs")
    await clickMenuItemText("检查本地变更")

    expect(mocks.rescanDriveSyncBinding).toHaveBeenCalledWith({ id: "binding-1" })
    expect(mocks.getDriveSyncSnapshot).toHaveBeenCalledTimes(2)
    expect(mocks.toast).toHaveBeenCalledWith("本地路径不存在。")
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("本地路径不存在。")
    expect(getButtonByLabel("重试同步 Docs").textContent).toContain("重试同步")
  })

  it("does not show a success toast when a manual sync action records an error", async () => {
    mocks.getDriveSyncSnapshot
      .mockResolvedValueOnce(createDriveSyncSnapshot(
        { activeBindingCount: 1 },
        { bindings: [createDriveSyncBinding({ driveItemName: "Docs" })] },
      ))
      .mockResolvedValueOnce(createDriveSyncSnapshot(
        { errorCount: 1 },
        { bindings: [createDriveSyncBinding({ driveItemName: "Docs", status: "error", lastError: "上传失败。" })] },
      ))
    mocks.rescanDriveSyncBinding.mockResolvedValueOnce(undefined)

    await render(<DriveModule />)
    await flushAct()
    await clickButtonByLabel("同步状态：1 个绑定")
    await clickButtonByLabel("更多同步操作 Docs")
    await clickMenuItemText("检查本地变更")

    expect(mocks.rescanDriveSyncBinding).toHaveBeenCalledWith({ id: "binding-1" })
    expect(mocks.getDriveSyncSnapshot).toHaveBeenCalledTimes(2)
    expect(mocks.toast).toHaveBeenCalledWith("上传失败。")
    expect(mocks.toast).not.toHaveBeenCalledWith("已检查本地变更")
    expect(getButtonByLabel("重试同步 Docs").textContent).toContain("重试同步")
  })

  it("does not show a success toast when a manual remote sync records a conflict", async () => {
    mocks.getDriveSyncSnapshot
      .mockResolvedValueOnce(createDriveSyncSnapshot(
        { activeBindingCount: 1 },
        { bindings: [createDriveSyncBinding({ driveItemName: "Docs" })] },
      ))
      .mockResolvedValueOnce(createDriveSyncSnapshot(
        { conflictCount: 1 },
        {
          bindings: [createDriveSyncBinding({ driveItemName: "Docs", status: "conflict" })],
          conflicts: [{
            id: "conflict-1",
            bindingId: "binding-1",
            relativePath: "spec.md",
            type: "both_modified",
            createdAt: "2026-06-28T00:00:00.000Z",
          }],
        },
      ))
    mocks.pollDriveSyncRemoteChanges.mockResolvedValueOnce(undefined)

    await render(<DriveModule />)
    await flushAct()
    await clickButtonByLabel("同步状态：1 个绑定")
    await clickButtonByLabel("更多同步操作 Docs")
    await clickMenuItemText("同步云端变更")

    expect(mocks.pollDriveSyncRemoteChanges).toHaveBeenCalledWith({ id: "binding-1" })
    expect(mocks.toast).toHaveBeenCalledWith("同步产生冲突，请处理冲突")
    expect(mocks.toast).not.toHaveBeenCalledWith("已同步云端变更")
    expect(getButtonByLabel("处理同步冲突 Docs").textContent).toContain("处理冲突")
  })

  it("runs local and remote sync checks when retrying an error binding", async () => {
    mocks.getDriveSyncSnapshot
      .mockResolvedValueOnce(createDriveSyncSnapshot(
        { errorCount: 1 },
        { bindings: [createDriveSyncBinding({ driveItemName: "Docs", status: "error", lastError: "上传失败。" })] },
      ))
      .mockResolvedValueOnce(createDriveSyncSnapshot(
        { activeBindingCount: 1 },
        { bindings: [createDriveSyncBinding({ driveItemName: "Docs", status: "active", lastError: null })] },
      ))

    await render(<DriveModule />)
    await flushAct()
    await clickButtonByLabel("同步状态：1 个错误")
    await clickButtonByLabel("重试同步 Docs")

    expect(mocks.resumeDriveSyncBinding).toHaveBeenCalledWith({ id: "binding-1" })
    expect(mocks.rescanDriveSyncBinding).toHaveBeenCalledWith({ id: "binding-1" })
    expect(mocks.pollDriveSyncRemoteChanges).toHaveBeenCalledWith({ id: "binding-1" })
    expect(mocks.getDriveSyncSnapshot).toHaveBeenCalledTimes(2)
    expect(mocks.toast).toHaveBeenCalledWith("已重试同步")
  })

  it("refreshes the sync snapshot after failed retry actions", async () => {
    mocks.getDriveSyncSnapshot
      .mockResolvedValueOnce(createDriveSyncSnapshot(
        { errorCount: 1 },
        { bindings: [createDriveSyncBinding({ driveItemName: "Docs", status: "error", lastError: "旧错误" })] },
      ))
      .mockResolvedValueOnce(createDriveSyncSnapshot(
        { errorCount: 1 },
        { bindings: [createDriveSyncBinding({ driveItemName: "Docs", status: "error", lastError: "本地路径不存在。" })] },
      ))
    mocks.resumeDriveSyncBinding.mockRejectedValueOnce(new Error("本地路径不存在。"))

    await render(<DriveModule />)
    await flushAct()
    await clickButtonByLabel("同步状态：1 个错误")
    await clickButtonByLabel("重试同步 Docs")

    expect(mocks.resumeDriveSyncBinding).toHaveBeenCalledWith({ id: "binding-1" })
    expect(mocks.getDriveSyncSnapshot).toHaveBeenCalledTimes(2)
    expect(mocks.toast).toHaveBeenCalledWith("本地路径不存在。")
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("本地路径不存在。")
  })

  it("uses status-specific primary drive sync actions", async () => {
    mocks.getDriveSyncSnapshot.mockResolvedValue(createDriveSyncSnapshot(
      { activeBindingCount: 1, conflictCount: 1, errorCount: 1 },
      {
        bindings: [
          createDriveSyncBinding({ id: "binding-active", driveItemName: "Active", status: "active" }),
          createDriveSyncBinding({ id: "binding-conflict", driveItemName: "Conflict", status: "conflict" }),
          createDriveSyncBinding({ id: "binding-paused", driveItemName: "Paused", status: "paused" }),
          createDriveSyncBinding({ id: "binding-error", driveItemName: "Error", status: "error", lastError: null }),
        ],
        conflicts: [{
          id: "conflict-1",
          bindingId: "binding-conflict",
          relativePath: "spec.md",
          type: "both_modified",
          localSummary: "本地：文件，路径 spec.md，大小 12 B",
          remoteSummary: "云端：文件，路径 /Docs/spec.md，版本 v2",
          createdAt: "2026-06-28T00:00:00.000Z",
        }],
      },
    ))

    await render(<DriveModule />)
    await flushAct()
    await clickButtonByLabel("同步状态：1 个冲突")

    expect(getButtonByLabel("查看同步详情 Active").textContent).toContain("详情")
    expect(getButtonByLabel("处理同步冲突 Conflict").textContent).toContain("处理冲突")
    expect(getButtonByLabel("继续同步 Paused").textContent).toContain("继续同步")
    expect(getButtonByLabel("重试同步 Error").textContent).toContain("重试同步")
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("同步失败，请查看同步记录")

    await clickButtonByLabel("处理同步冲突 Conflict")

    const detailDialog = Array.from(document.querySelectorAll('[role="dialog"]'))
      .find((candidate) => candidate.textContent?.includes("本地：文件，路径 spec.md，大小 12 B"))
    if (!detailDialog) throw new Error("Drive sync conflict detail dialog not found")
    expect(detailDialog.textContent).toContain("云端：文件，路径 /Docs/spec.md，版本 v2")
  })

  it("filters drive sync objects by status tabs", async () => {
    mocks.getDriveSyncSnapshot.mockResolvedValue(createDriveSyncSnapshot(
      { activeBindingCount: 1, conflictCount: 1, errorCount: 1 },
      {
        bindings: [
          createDriveSyncBinding({ id: "binding-active", driveItemName: "Active", status: "active" }),
          createDriveSyncBinding({ id: "binding-conflict", driveItemName: "Conflict", status: "conflict" }),
          createDriveSyncBinding({ id: "binding-paused", driveItemName: "Paused", status: "paused" }),
          createDriveSyncBinding({ id: "binding-error", driveItemName: "Error", status: "error" }),
        ],
        conflicts: [{
          id: "conflict-1",
          bindingId: "binding-conflict",
          relativePath: "spec.md",
          type: "both_modified",
          createdAt: "2026-06-28T00:00:00.000Z",
        }],
      },
    ))

    await render(<DriveModule />)
    await flushAct()
    await clickButtonByLabel("同步状态：1 个冲突")

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Active")
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Conflict")

    await clickTabText("有冲突")
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Active")
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Conflict")
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Paused")
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Error")

    await clickTabText("已暂停")
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Conflict")
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Paused")

    await clickTabText("错误")
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Paused")
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Error")
  })

  it("opens the drive sync binding wizard from a row menu", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", type: "file", name: "report.txt" }),
    ])

    await render(<DriveModule />)
    await flushAct()

    await openRowMenu("report.txt")
    await clickMenuItemText("同步")

    const dialog = document.querySelector('[role="dialog"]')
    if (!dialog) throw new Error("Drive sync binding dialog not found")
    expect(dialog.textContent).toContain("绑定同步")
    expect(dialog.textContent).toContain("绑定已有本地项")
    expect(dialog.textContent).toContain("下载到本地")
    const modeTabs = Array.from(dialog.querySelectorAll('[role="tab"]'))
    expect(modeTabs.map((tab) => tab.textContent)).toEqual(["绑定已有本地项", "下载到本地"])
    expect(modeTabs[0]?.getAttribute("aria-selected")).toBe("true")
    expect(modeTabs[1]?.getAttribute("aria-selected")).toBe("false")
    expect(dialog.textContent).toContain("本地文件")
    expect(dialog.querySelector("input")?.getAttribute("placeholder")).toBe("选择已有本地文件")
    expect(dialog.textContent).toContain("选择文件")
    expect(dialog.textContent).toContain("创建同步")
    expect(dialog.textContent).not.toContain("本地路径")
    expect(dialog.textContent).not.toContain("排除规则")
  })

  it("selects local paths for bind-existing and remote download modes", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", type: "file", name: "report.txt" }),
    ])
    mocks.chooseDriveSyncLocalPath.mockResolvedValueOnce("/Users/me/Desktop/report.txt")
    mocks.previewDriveSyncBinding.mockResolvedValueOnce({
      status: "ready",
      direction: "bind_existing",
      reason: null,
      localPath: "/Users/me/Desktop/report.txt",
      localKind: "file",
      localEmpty: null,
      forcedExcludeRules: [".git/**", ".git"],
      defaultExcludeRules: [],
      importedGitignoreRules: [],
    })

    await render(<DriveModule />)
    await flushAct()
    await openRowMenu("report.txt")
    await clickMenuItemText("同步")
    await clickText("选择文件")

    expect(mocks.chooseDriveSyncLocalPath).toHaveBeenCalledWith({
      kind: "file",
      mode: "bind_existing",
      defaultName: "report.txt",
    })
    expect(mocks.previewDriveSyncBinding).toHaveBeenCalledWith(expect.objectContaining({
      driveItemId: "file-1",
      directionHint: "bind_existing",
      localPath: "/Users/me/Desktop/report.txt",
    }))

    await clickTabText("下载到本地")
    const modeTabs = Array.from(document.body.querySelectorAll('[role="tab"]'))
    expect(modeTabs[0]?.getAttribute("aria-selected")).toBe("false")
    expect(modeTabs[1]?.getAttribute("aria-selected")).toBe("true")
    const dialog = document.querySelector('[role="dialog"]')
    if (!dialog) throw new Error("Drive sync binding dialog not found")
    expect(dialog.textContent).toContain("保存为")
    expect(dialog.querySelector("input")?.getAttribute("placeholder")).toBe("选择保存位置")
    expect(dialog.textContent).toContain("选择位置")
    expect(dialog.textContent).toContain("下载并同步")
    await clickText("选择位置")

    expect(mocks.chooseDriveSyncLocalPath).toHaveBeenLastCalledWith({
      kind: "file",
      mode: "remote_to_local",
      defaultName: "report.txt",
    })
  })

  it("passes full nested drive paths when creating sync bindings from row menus", async () => {
    mocks.listDriveItems
      .mockResolvedValueOnce([
        createDriveItem({ id: "folder-projects", type: "folder", name: "Projects" }),
      ])
      .mockResolvedValueOnce([
        createDriveItem({ id: "folder-docs", parentId: "folder-projects", type: "folder", name: "Docs" }),
      ])
    mocks.chooseDriveSyncLocalPath.mockResolvedValueOnce("/Users/me/Docs")
    mocks.previewDriveSyncBinding.mockResolvedValueOnce({
      status: "ready",
      direction: "bind_existing",
      reason: null,
      localPath: "/Users/me/Docs",
      localKind: "folder",
      localEmpty: true,
      forcedExcludeRules: [".git/**", ".git"],
      defaultExcludeRules: [],
      importedGitignoreRules: [],
    })

    await render(<DriveModule />)
    await flushAct()
    await act(async () => {
      getTableRow("Projects").click()
      await flushPromises()
    })
    await openRowMenu("Docs")
    await clickMenuItemText("同步")
    await clickText("选择文件夹")

    expect(mocks.previewDriveSyncBinding).toHaveBeenCalledWith(expect.objectContaining({
      driveItemId: "folder-docs",
      drivePathHint: "/Projects/Docs",
      kind: "folder",
      localPath: "/Users/me/Docs",
    }))
  })

  it("creates local-to-cloud drive sync bindings from the toolbar", async () => {
    mocks.chooseDriveSyncLocalPath.mockResolvedValueOnce("/Users/me/LocalDocs")
    mocks.previewDriveSyncBinding.mockResolvedValueOnce({
      status: "ready",
      direction: "local_to_remote",
      reason: null,
      localPath: "/Users/me/LocalDocs",
      localKind: "folder",
      localEmpty: false,
      forcedExcludeRules: [".git/**", ".git"],
      defaultExcludeRules: [],
      importedGitignoreRules: [],
    })

    await render(<DriveModule />)
    await flushAct()
    await clickDriveToolbarMenuItem("更多", "本地同步")

    const dialog = document.querySelector('[role="dialog"]')
    if (!dialog) throw new Error("Local drive sync dialog not found")
    expect(dialog.textContent).toContain("本地同步")
    expect(Array.from(dialog.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent)).toEqual(["文件", "文件夹"])

    await clickText("选择文件夹")

    expect(mocks.chooseDriveSyncLocalPath).toHaveBeenCalledWith({
      kind: "folder",
      mode: "local_to_remote",
      defaultName: undefined,
    })
    expect(mocks.previewDriveSyncBinding).toHaveBeenCalledWith(expect.objectContaining({
      driveItemId: "local:/Users/me/LocalDocs",
      driveItemName: "LocalDocs",
      kind: "folder",
      localPath: "/Users/me/LocalDocs",
      remoteExists: false,
      directionHint: "local_to_remote",
      importGitignore: true,
    }))
    expect(dialog.textContent).toContain("上传并同步")

    const listCallsBeforeSubmit = mocks.listDriveItems.mock.calls.length
    const usageCallsBeforeSubmit = mocks.getDriveUsage.mock.calls.length

    await clickButtonText("上传并同步")

    expect(mocks.createDriveSyncSafeBinding).toHaveBeenCalledWith(expect.objectContaining({
      driveItemId: "local:/Users/me/LocalDocs",
      driveItemName: "LocalDocs",
      kind: "folder",
      drivePathHint: "/LocalDocs",
      targetParentId: null,
      localPath: "/Users/me/LocalDocs",
      direction: "local_to_remote",
      importGitignore: true,
    }))
    expect(mocks.listDriveItems).toHaveBeenCalledTimes(listCallsBeforeSubmit + 1)
    expect(mocks.getDriveUsage).toHaveBeenCalledTimes(usageCallsBeforeSubmit + 1)
  })

  it("uploads local-to-cloud sync roots into the current Drive folder", async () => {
    mocks.listDriveItems
      .mockResolvedValueOnce([
        createDriveItem({ id: "folder-projects", type: "folder", name: "Projects" }),
      ])
      .mockResolvedValueOnce([])
    mocks.chooseDriveSyncLocalPath.mockResolvedValueOnce("/Users/me/LocalDocs")
    mocks.previewDriveSyncBinding.mockResolvedValueOnce({
      status: "ready",
      direction: "local_to_remote",
      reason: null,
      localPath: "/Users/me/LocalDocs",
      localKind: "folder",
      localEmpty: false,
      forcedExcludeRules: [".git/**", ".git"],
      defaultExcludeRules: [],
      importedGitignoreRules: [],
    })

    await render(<DriveModule />)
    await flushAct()
    await act(async () => {
      getTableRow("Projects").click()
      await flushPromises()
    })
    await clickDriveToolbarMenuItem("更多", "本地同步")

    const dialog = document.querySelector('[role="dialog"]')
    if (!dialog) throw new Error("Local drive sync dialog not found")
    expect(dialog.textContent).toContain("/Projects")

    await clickText("选择文件夹")
    await clickButtonText("上传并同步")

    expect(mocks.createDriveSyncSafeBinding).toHaveBeenCalledWith(expect.objectContaining({
      driveItemId: "local:/Users/me/LocalDocs",
      driveItemName: "LocalDocs",
      kind: "folder",
      drivePathHint: "/Projects/LocalDocs",
      targetParentId: "folder-projects",
      localPath: "/Users/me/LocalDocs",
      direction: "local_to_remote",
      importGitignore: true,
    }))
  })

  it("sends folder exclude rules when previewing drive sync bindings", async () => {
    mocks.chooseDriveSyncLocalPath.mockResolvedValueOnce("/Users/me/LocalDocs")

    await render(<DriveModule />)
    await flushAct()
    await clickDriveToolbarMenuItem("更多", "本地同步")
    await clickText("选择文件夹")
    mocks.previewDriveSyncBinding.mockClear()

    await textAreaInput("drive-sync-excludes", "build/**\n.tmp/")
    await clickButtonText("校验")

    expect(mocks.previewDriveSyncBinding).toHaveBeenCalledWith(expect.objectContaining({
      driveItemId: "local:/Users/me/LocalDocs",
      kind: "folder",
      localPath: "/Users/me/LocalDocs",
      excludeRules: ["build/**", ".tmp/"],
      importGitignore: true,
    }))
  })

  it("keeps the sync dialog open when initial safe create returns an error binding", async () => {
    mocks.createDriveSyncSafeBinding.mockResolvedValueOnce(createDriveSyncBinding({
      status: "error",
      lastError: "初始下载失败",
    }))
    mocks.chooseDriveSyncLocalPath.mockResolvedValueOnce("/Users/me/LocalDocs")
    mocks.previewDriveSyncBinding.mockResolvedValueOnce({
      status: "ready",
      direction: "local_to_remote",
      reason: null,
      localPath: "/Users/me/LocalDocs",
      localKind: "folder",
      localEmpty: false,
      forcedExcludeRules: [".git/**", ".git"],
      defaultExcludeRules: [],
      importedGitignoreRules: [],
    })

    await render(<DriveModule />)
    await flushAct()
    await clickDriveToolbarMenuItem("更多", "本地同步")
    await clickText("选择文件夹")
    await clickButtonText("上传并同步")

    expect(mocks.toast).toHaveBeenCalledWith("初始下载失败")
    expect(mocks.toast).not.toHaveBeenCalledWith("已创建同步绑定")
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("本地同步")
  })

  it("disables binding submit when the current preview is blocked", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", type: "file", name: "report.txt" }),
    ])
    mocks.chooseDriveSyncLocalPath.mockResolvedValueOnce("/Users/me/Desktop/mismatch.txt")
    mocks.previewDriveSyncBinding.mockResolvedValueOnce({
      status: "blocked",
      direction: null,
      reason: "本地文件与云盘文件大小不一致，不能直接建立绑定。",
      localPath: "/Users/me/Desktop/mismatch.txt",
      localKind: "file",
      localEmpty: null,
      forcedExcludeRules: [".git/**", ".git"],
      defaultExcludeRules: [],
      importedGitignoreRules: [],
    })

    await render(<DriveModule />)
    await flushAct()
    await openRowMenu("report.txt")
    await clickMenuItemText("同步")
    await clickText("选择文件")

    const dialog = document.querySelector('[role="dialog"]')
    if (!dialog) throw new Error("Drive sync binding dialog not found")
    const submitButton = Array.from(dialog.querySelectorAll("button"))
      .filter((button) => button.textContent === "创建同步")
      .at(-1)
    expect(dialog.textContent).toContain("不可绑定")
    expect(dialog.textContent).toContain("本地文件与云盘文件大小不一致")
    expect((submitButton as HTMLButtonElement | undefined)?.disabled).toBe(true)
  })

  it("shows drive capacity usage next to the title", async () => {
    await render(<DriveModule />)
    await flushAct()

    expect(mocks.getDriveUsage).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain("4 B / 100 B")
    expect(document.body.textContent).not.toContain("已占用")
    expect(document.querySelector('[aria-label="云盘容量"]')?.getAttribute("aria-valuenow")).toBe("4")
  })

  it("counts reserved bytes as occupied capacity", async () => {
    mocks.getDriveUsage.mockResolvedValueOnce({ usedBytes: "40", reservedBytes: "10", quotaBytes: "100" })

    await render(<DriveModule />)
    await flushAct()

    expect(document.body.textContent).toContain("50 B / 100 B")
    expect(document.querySelector('[aria-label="云盘容量"]')?.getAttribute("aria-valuenow")).toBe("50")
  })

  it("keeps file actions available without local search", () => {
    const html = renderToStaticMarkup(<DriveModule />)

    expect(html).not.toContain('aria-label="搜索"')
    expect(html).toContain("新建")
    expect(html).not.toContain("上传文件")
    expect(html).not.toContain("上传文件夹")
    expect(html).not.toContain("新建文件夹")
  })

  it("shows an account login state without listing drive items when unauthenticated", async () => {
    accountState.current = { status: "unauthenticated" }
    mocks.getDriveSyncSnapshot.mockResolvedValue(createDriveSyncSnapshot(
      { activeBindingCount: 1 },
      { bindings: [createDriveSyncBinding()] },
    ))

    await render(<DriveModule />)
    await flushAct()

    expect(mocks.listDriveItems).not.toHaveBeenCalled()
    expect(mocks.getDriveUsage).not.toHaveBeenCalled()
    expect(mocks.getDriveSyncSnapshot).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain("需要登录账号")
    expect(document.body.textContent).toContain("登录后才能查看云盘。")
    expect(document.body.textContent).not.toContain("synapse:account:drive:items:list")
    expect(queryButton("上传文件")).toBeNull()
    expect(queryButton("上传文件夹")).toBeNull()
    expect(getButton("新建").disabled).toBe(true)
    expect(getButtonByLabel("更多").disabled).toBe(true)
    expect(getButtonByLabel("刷新").disabled).toBe(true)
    expect(getButtonByLabel("同步状态：1 个绑定").textContent).toContain("1")
    expect(queryButtonByLabel("同步状态：暂无同步绑定")).toBeNull()
    expect(queryButton("已分享")).toBeNull()
    expect(queryButton("已发布")).toBeNull()

    await clickButtonByLabel("同步状态：1 个绑定")

    expect(document.body.textContent).toContain("Docs")
    expect(document.body.textContent).not.toContain("暂无同步对象")

    await clickButtonText("登录")

    expect(accountActions.startLogin).toHaveBeenCalledTimes(1)
  })

  it("waits for account login before enabling drive actions", async () => {
    accountState.current = { status: "authenticating", loginUrl: "https://example.com/login" }

    await render(<DriveModule />)
    await flushAct()

    expect(mocks.listDriveItems).not.toHaveBeenCalled()
    expect(mocks.getDriveUsage).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("等待账号登录")
    expect(document.body.textContent).toContain("在浏览器完成登录后会自动刷新。")
    expect(queryButton("上传文件")).toBeNull()
    expect(queryButton("上传文件夹")).toBeNull()
    expect(getButton("新建").disabled).toBe(true)
    expect(getButtonByLabel("更多").disabled).toBe(true)
    expect(getButtonByLabel("刷新").disabled).toBe(true)
    expect(queryButton("已分享")).toBeNull()
    expect(queryButton("已发布")).toBeNull()
  })

  it("keeps management actions disabled while the drive list is loading", async () => {
    let resolveItems: (items: DriveItemDto[]) => void = () => {}
    mocks.listDriveItems.mockReturnValue(new Promise<DriveItemDto[]>((resolve) => {
      resolveItems = resolve
    }))

    await render(<DriveModule />)
    await flushPromises()

    expect(getButtonByLabel("更多").disabled).toBe(true)
    expect(queryButton("已分享")).toBeNull()
    expect(queryButton("已发布")).toBeNull()

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
      createDriveItem({ id: "failed-folder", name: "failed-folder", type: "folder", storageStatus: "failed" }),
      createDriveItem({ id: "deleting-file", name: "deleting.txt", type: "file", storageStatus: "delete_pending" }),
      createDriveItem({
        id: "shared-file",
        name: "shared.txt",
        type: "file",
        shared: true,
        activeShareId: "share-row-1",
        activeShare: createDriveActiveShare({
          accessMode: "link_edit",
          expiresAt: driveShareExpiresInDays(3),
          passwordEnabled: true,
        }),
      }),
      createDriveItem({ id: "folder-1", name: "folder", type: "folder" }),
    ])

    await render(<DriveModule />)
    await flushAct()

    expect(document.body.textContent).toContain("上传中")
    expect(document.body.textContent).toContain("上传失败")
    expect(document.body.textContent).toContain("删除中")
    expect(document.body.textContent).toContain("分享：3天 · 密码 · 登录可编辑")
    expect(tableHeaderTexts()).toEqual(["名称", "大小", "更新时间", ""])
    expect(actionColumnHeader()?.getAttribute("aria-label")).toBe("操作")
    expect(getTableRow("pending.txt").querySelector("td")?.textContent).toContain("上传中")
    expect(getTableRow("failed.txt").querySelector("td")?.textContent).toContain("上传失败")
    expect(getTableRow("failed-folder").querySelector("td")?.textContent).toContain("上传失败")
    expect(getTableRow("deleting.txt").querySelector("td")?.textContent).toContain("删除中")
    expect(getTableRow("shared.txt").querySelector("td")?.textContent).toContain("分享：3天 · 密码 · 登录可编辑")
    const failedBadge = Array.from(document.querySelectorAll<HTMLElement>("[data-slot='badge']"))
      .find((element) => element.textContent === "上传失败")
    expect(failedBadge?.dataset.variant).toBe("destructive")
    for (const name of ["pending.txt", "failed.txt", "deleting.txt"]) {
      const shareButton = rowButton(name, "分享")
      expect(shareButton?.disabled).toBe(true)
      expect(rowButton(name, "预览")?.disabled).toBe(true)
      expect(rowButton(name, "取消分享")).toBeUndefined()
    }
    expect(rowButton("failed-folder", "预览")?.disabled).toBe(true)
    getTableRow("failed-folder").click()
    await flushAct()
    expect(mocks.listDriveItems).toHaveBeenCalledTimes(1)
    expect(rowButton("shared.txt", "分享")).toBeUndefined()
    expect(rowButton("shared.txt", "取消分享")?.disabled).toBe(false)
  })

  it("shows shared state as lightweight inline metadata", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({
        activeShare: createDriveActiveShare({
          accessMode: "specified_users_edit",
          editorCount: 2,
          expiresAt: driveShareExpiresInDays(7),
          passwordEnabled: true,
        }),
        activeShareId: "share-row-1",
        id: "html-1",
        mimeType: "text/html",
        name: "report.html",
        shared: true,
        type: "file",
      }),
    ])

    await render(<DriveModule />)
    await flushAct()

    const reportRow = getTableRow("report.html")
    const nameCell = reportRow.querySelector("td")
    const reportBadges = Array.from(nameCell?.querySelectorAll<HTMLElement>("[data-slot='badge']") ?? [])
      .map((element) => element.textContent)
    expect(reportBadges).toEqual([])
    expect(nameCell?.textContent).toContain("分享：7天 · 密码 · 2人可编辑")
  })

  it("renders the full current folder without a local search input", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", name: "chart_watermark.png", type: "file" }),
      createDriveItem({ id: "folder-1", name: "作业范文", type: "folder" }),
    ])
    await render(<DriveModule />)
    await flushAct()

    expect(document.querySelector('input[aria-label="搜索"]')).toBeNull()
    expect(document.body.textContent).toContain("chart_watermark.png")
    expect(document.body.textContent).toContain("作业范文")
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
    await clickDriveRow("作业范文")
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

  it("ignores stale directory refresh responses after opening a folder", async () => {
    const staleRootRefresh = createDeferred<DriveItemDto[]>()
    mocks.listDriveItems
      .mockResolvedValueOnce([
        createDriveItem({ id: "file-1", name: "常用.md", type: "file" }),
        createDriveItem({ id: "folder-1", name: "作业范文", type: "folder" }),
      ])
      .mockReturnValueOnce(staleRootRefresh.promise)
      .mockResolvedValueOnce([
        createDriveItem({ id: "file-2", name: "cui.md", type: "file", parentId: "folder-1" }),
      ])

    await render(<DriveModule />)
    await flushAct()

    const folderRow = getTableRow("作业范文")
    await act(async () => {
      getButtonByLabel("刷新").click()
      folderRow.click()
      await flushPromises()
    })
    expect(mocks.listDriveItems).toHaveBeenLastCalledWith({ parentId: "folder-1" })
    await flushAct()
    expect(document.body.textContent).toContain("cui.md")
    expect(document.querySelector('[aria-current="page"]')?.textContent).toBe("作业范文")

    await act(async () => {
      staleRootRefresh.resolve([
        createDriveItem({ id: "stale-root", name: "stale-root.txt", type: "file" }),
      ])
      await flushPromises()
    })

    expect(document.querySelector('[aria-current="page"]')?.textContent).toBe("作业范文")
    expect(document.body.textContent).toContain("cui.md")
    expect(document.body.textContent).not.toContain("stale-root.txt")
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

  it("keeps item names selectable and opens folders from the folder name", async () => {
    mocks.listDriveItems
      .mockResolvedValueOnce([
        createDriveItem({ id: "folder-1", name: "作业范文", type: "folder" }),
        createDriveItem({ id: "file-1", name: "常用.md", type: "file" }),
      ])
      .mockResolvedValueOnce([
        createDriveItem({ id: "file-2", name: "cui.md", type: "file", parentId: "folder-1" }),
      ])

    await render(<DriveModule />)
    await flushAct()

    const folderName = driveItemNameElement("作业范文")
    const fileName = driveItemNameElement("常用.md")
    expect(folderName.className).toContain("select-text")
    expect(fileName.className).toContain("select-text")

    await act(async () => {
      folderName.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
      folderName.click()
      await flushPromises()
    })
    await flushAct()

    expect(mocks.listDriveItems).toHaveBeenLastCalledWith({ parentId: "folder-1" })
    expect(document.body.textContent).toContain("cui.md")
  })

  it("does not open a folder when releasing a row click after selecting its name", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "folder-1", name: "作业范文", type: "folder" }),
      createDriveItem({ id: "file-1", name: "常用.md", type: "file" }),
    ])

    await render(<DriveModule />)
    await flushAct()

    selectElementText(driveItemNameElement("作业范文"))

    await act(async () => {
      driveItemNameElement("作业范文").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
      getTableRow("作业范文").click()
      await flushPromises()
    })

    expect(mocks.listDriveItems).toHaveBeenCalledTimes(1)
  })

  it("does not open a folder from the name context menu", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "folder-1", name: "作业范文", type: "folder" }),
    ])

    await render(<DriveModule />)
    await flushAct()

    await openDriveNameContextMenu("作业范文")

    expect(menuItemTexts()).toEqual(["复制名称", "复制路径", "重命名"])
    expect(mocks.listDriveItems).toHaveBeenCalledTimes(1)
  })

  it("opens a file preview when clicking its name", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", name: "report.txt", type: "file" }),
    ])

    await render(<DriveModule />)
    await flushAct()

    const fileName = driveItemNameElement("report.txt")
    await act(async () => {
      fileName.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
      fileName.click()
      await flushPromises()
    })

    expect(fileName.className).toContain("cursor-pointer")
    expect(fileName.className).toContain("hover:underline")
    expect(mocks.getDriveItemPreviewUrl).toHaveBeenCalledWith({ itemId: "file-1" })
    expect(mocks.openExternal).toHaveBeenCalledWith("https://synapse.test/drive/items/file-1")
  })

  it("does not preview a file when releasing a name click after selecting its name", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", name: "report.txt", type: "file" }),
    ])

    await render(<DriveModule />)
    await flushAct()

    selectElementText(driveItemNameElement("report.txt"))

    await act(async () => {
      const fileName = driveItemNameElement("report.txt")
      fileName.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
      fileName.click()
      await flushPromises()
    })

    expect(mocks.getDriveItemPreviewUrl).not.toHaveBeenCalled()
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it("does not expose a clickable file name for unavailable previews", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", name: "pending.txt", type: "file", storageStatus: "pending" }),
    ])

    await render(<DriveModule />)
    await flushAct()

    const fileName = driveItemNameElement("pending.txt")
    expect(fileName.className).not.toContain("cursor-pointer")
    expect(fileName.className).not.toContain("hover:underline")

    await act(async () => {
      fileName.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
      fileName.click()
      await flushPromises()
    })

    expect(mocks.getDriveItemPreviewUrl).not.toHaveBeenCalled()
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it("opens a folder from row whitespace after a previous name selection", async () => {
    mocks.listDriveItems
      .mockResolvedValueOnce([
        createDriveItem({ id: "folder-1", name: "作业范文", type: "folder" }),
      ])
      .mockResolvedValueOnce([
        createDriveItem({ id: "file-1", name: "cui.md", type: "file", parentId: "folder-1" }),
      ])

    await render(<DriveModule />)
    await flushAct()

    selectElementText(driveItemNameElement("作业范文"))

    await act(async () => {
      const row = getTableRow("作业范文")
      row.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
      row.click()
      await flushPromises()
    })
    await flushAct()

    expect(mocks.listDriveItems).toHaveBeenLastCalledWith({ parentId: "folder-1" })
    expect(document.body.textContent).toContain("cui.md")
  })

  it("opens a name context menu for copying name and drive path", async () => {
    mocks.listDriveItems
      .mockResolvedValueOnce([
        createDriveItem({ id: "folder-1", name: "作业范文", type: "folder" }),
      ])
      .mockResolvedValueOnce([
        createDriveItem({ id: "file-1", name: "cui.md", type: "file", parentId: "folder-1" }),
      ])

    await render(<DriveModule />)
    await flushAct()
    await clickDriveRow("作业范文")
    await flushAct()

    await openDriveNameContextMenu("cui.md")

    expect(menuItemTexts()).toEqual(["复制名称", "复制路径", "重命名"])

    await clickText("复制名称")
    expect(mocks.writeClipboardText).toHaveBeenLastCalledWith("cui.md")
    expect(mocks.toast).toHaveBeenCalledWith("名称已复制")

    await openDriveNameContextMenu("cui.md")
    await clickText("复制路径")

    expect(mocks.writeClipboardText).toHaveBeenLastCalledWith("/作业范文/cui.md")
    expect(mocks.toast).toHaveBeenCalledWith("路径已复制")
    expect(mocks.listDriveItems).toHaveBeenCalledTimes(2)
  })

  it("renames an item from the name context menu", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", name: "cui.md", type: "file" }),
    ])

    await render(<DriveModule />)
    await flushAct()

    await openDriveNameContextMenu("cui.md")
    await clickText("重命名")

    expect(document.body.textContent).toContain("重命名")
    expect(document.querySelector<HTMLInputElement>("#drive-item-name")?.value).toBe("cui.md")
  })

  it("uses distinct drive item icons, table columns, and a compact breadcrumb trail", async () => {
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

    expect(document.querySelector(".lucide-archive")).not.toBeNull()
    expect(document.querySelector(".lucide-trash-2")).not.toBeNull()
    expect(document.querySelector(".lucide-file")).not.toBeNull()
    expect(document.querySelector(".lucide-folder-closed")).not.toBeNull()
    expect(driveItemNameElement("公开素材").closest("tr")?.querySelector(".lucide-folder-closed")).toBeNull()
    expect(driveItemNameElement("回收站").closest("tr")?.querySelector(".lucide-folder-closed")).toBeNull()
    expect(driveItemNameElement("作业范文").className).toContain("select-text")
    expect(document.querySelector("table")).not.toBeNull()
    expect(tableHeaderTexts()).toEqual(["名称", "大小", "更新时间", ""])
    expect(actionColumnHeader()?.getAttribute("aria-label")).toBe("操作")

    await clickDriveRow("作业范文")
    await flushAct()

    const breadcrumbNav = document.querySelector<HTMLElement>('nav[aria-label="当前位置"]')
    expect(breadcrumbNav).not.toBeNull()
    expect(breadcrumbNav?.className).toContain("flex-1")
    expect(breadcrumbNav?.className).toContain("overflow-x-auto")
    expect(breadcrumbNav?.parentElement?.className).toContain("min-h-8")
    expect(breadcrumbNav?.parentElement?.className).not.toContain("rounded-lg")
    expect(breadcrumbNav?.parentElement?.className).not.toContain("border")
    expect(breadcrumbNav?.querySelector(".lucide-chevron-right")).not.toBeNull()
    expect(breadcrumbNav?.querySelector('[aria-current="page"]')?.textContent).toBe("作业范文")
    expect(breadcrumbNav?.querySelector('[aria-current="page"]')?.className).not.toContain("bg-muted")
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
    expect(tableColumnClasses()).toEqual(["w-auto", "w-24", "w-40", "w-52"])
    expect(tableContainer()?.className).not.toContain("overflow-x-hidden")
    expect(document.body.textContent).toContain("1.5 KB")

    const nameCellText = document.querySelector<HTMLElement>(`td span[title="${longName}"]`)
    expect(nameCellText?.className).toContain("truncate")
    expect(nameCellText?.className).toContain("whitespace-nowrap")
  })

  it("opens a folder name dialog before creating a folder", async () => {
    await render(<DriveModule />)

    await clickDriveToolbarMenuItem("新建", "新建文件夹")

    expect(document.querySelector('input[aria-label="文件夹名称"]')).not.toBeNull()
    expect(mocks.createDriveFolder).not.toHaveBeenCalled()
  })

  it("uploads selected files through the unified local upload bridge without reading file bodies", async () => {
    await render(<DriveModule />)
    await flushAct()
    mocks.getDriveUsage.mockClear()

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
      taskId: expect.any(String),
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
    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(mocks.getDriveUsage).toHaveBeenCalledTimes(1)
  })

  it("shows partial local upload failures as error toasts", async () => {
    mocks.uploadDriveLocalItems.mockResolvedValueOnce({
      completed: 60,
      failed: 30,
      skipped: 0,
      message: "上传确认失败。",
    })
    await render(<DriveModule />)
    await flushAct()

    const input = document.querySelector('input[type="file"]:not([webkitdirectory])')
    if (!(input instanceof HTMLInputElement)) throw new Error("File input not found")
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["report"], "report.txt", { type: "text/plain" })],
    })

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }))
      await flushPromises()
    })

    const message = "上传完成 60 个文件，失败 30 个：上传确认失败。"
    expect(mocks.toastError).toHaveBeenCalledWith(message, expect.objectContaining({
      duration: 5000,
    }))
    expect(mocks.toast).not.toHaveBeenCalledWith(message)
  })

  it("shows local upload exceptions as error toasts", async () => {
    mocks.uploadDriveLocalItems.mockRejectedValueOnce(new Error("上传失败"))
    await render(<DriveModule />)
    await flushAct()

    const input = document.querySelector('input[type="file"]:not([webkitdirectory])')
    if (!(input instanceof HTMLInputElement)) throw new Error("File input not found")
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["report"], "report.txt", { type: "text/plain" })],
    })

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }))
      await flushPromises()
    })

    expect(mocks.toastError).toHaveBeenCalledWith("上传失败", expect.objectContaining({
      duration: 5000,
    }))
    expect(mocks.toast).not.toHaveBeenCalledWith("上传失败")
    expect(document.body.textContent).toContain("上传失败")
    expect(document.body.textContent).toContain("失败1")
    expect(getButton("重试失败项")).not.toBeNull()
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
    expect(getButton("新建").disabled).toBe(false)
    expect(getButtonByLabel("更多").disabled).toBe(false)

    await openDriveToolbarMenu("新建")
    expect(getMenuItem("新建文件夹").hasAttribute("data-disabled")).toBe(false)
    expect(getMenuItem("上传文件").hasAttribute("data-disabled")).toBe(true)
    expect(getMenuItem("上传文件夹").hasAttribute("data-disabled")).toBe(true)
    await clickMenuItemText("新建文件夹")
    expect(document.querySelector('input[aria-label="文件夹名称"]')).not.toBeNull()

    await openDriveToolbarMenu("更多")
    expect(getMenuItem("本地同步").hasAttribute("data-disabled")).toBe(true)
    expect(getMenuItem("我的分享").hasAttribute("data-disabled")).toBe(false)
    expect(getMenuItem("站点").hasAttribute("data-disabled")).toBe(false)

    await act(async () => {
      upload.resolve({ completed: 1, failed: 0, skipped: 0 })
      await flushPromises()
    })
  })

  it("opens an upload task panel with selected file details", async () => {
    const upload = createDeferred<{ completed: number; failed: number; skipped: number }>()
    mocks.uploadDriveLocalItems.mockReturnValueOnce(upload.promise)
    await render(<DriveModule />)

    const input = document.querySelector('input[type="file"]:not([webkitdirectory])')
    if (!(input instanceof HTMLInputElement)) throw new Error("File input not found")
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["report"], "report.txt", { type: "text/plain" })],
    })

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }))
      await flushPromises()
    })

    expect(document.body.textContent).toContain("正在上传 1 项")
    await clickButtonText("正在上传 1 项")

    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain("report.txt")
    expect(dialog?.textContent).toContain("根目录")
    expect(dialog?.textContent).not.toContain("/tmp/report.txt")

    await act(async () => {
      upload.resolve({ completed: 1, failed: 0, skipped: 0 })
      await flushPromises()
    })
  })

  it("updates upload task rows from progress events", async () => {
    const upload = createDeferred<{ completed: number; failed: number; skipped: number }>()
    mocks.uploadDriveLocalItems.mockReturnValueOnce(upload.promise)
    await render(<DriveModule />)

    const input = document.querySelector('input[type="file"]:not([webkitdirectory])')
    if (!(input instanceof HTMLInputElement)) throw new Error("File input not found")
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["report"], "report.txt", { type: "text/plain" })],
    })

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }))
      await flushPromises()
    })
    await clickButtonText("正在上传 1 项")

    await act(async () => {
      emitDriveLocalUploadProgress({
        type: "item-started",
        taskId: lastUploadTaskId(),
        itemKey: "file:/tmp/report.txt",
      })
      await flushPromises()
    })
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("上传中")

    await act(async () => {
      emitDriveLocalUploadProgress({
        type: "item-completed",
        taskId: lastUploadTaskId(),
        itemKey: "file:/tmp/report.txt",
      })
      upload.resolve({ completed: 1, failed: 0, skipped: 0 })
      await flushPromises()
    })
    expect(document.body.textContent).toContain("已上传 1 项")
  })

  it("retries failed upload items in the original destination", async () => {
    const upload = createDeferred<{ completed: number; failed: number; skipped: number; message?: string }>()
    mocks.uploadDriveLocalItems
      .mockReturnValueOnce(upload.promise)
      .mockResolvedValueOnce({ completed: 1, failed: 0, skipped: 0 })
    mocks.listDriveItems
      .mockResolvedValueOnce([
        createDriveItem({ id: "folder-1", name: "作业范文", type: "folder" }),
      ])
      .mockResolvedValue([])
    await render(<DriveModule />)
    await flushAct()
    await clickDriveRow("作业范文")
    await flushAct()

    const input = document.querySelector('input[type="file"]:not([webkitdirectory])')
    if (!(input instanceof HTMLInputElement)) throw new Error("File input not found")
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["report"], "report.txt", { type: "text/plain" })],
    })

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }))
      await flushPromises()
    })

    const firstTaskId = lastUploadTaskId()
    await act(async () => {
      emitDriveLocalUploadProgress({
        type: "item-failed",
        taskId: firstTaskId,
        itemKey: "file:/tmp/report.txt",
        message: "上传失败。",
      })
      upload.resolve({ completed: 0, failed: 1, skipped: 0, message: "上传失败。" })
      await flushPromises()
    })
    await clickButtonText("根目录")

    await clickButtonText("重试失败项")

    expect(mocks.uploadDriveLocalItems).toHaveBeenLastCalledWith({
      taskId: expect.any(String),
      parentId: "folder-1",
      items: [{
        kind: "file",
        path: "/tmp/report.txt",
        name: "report.txt",
        mimeType: "text/plain",
      }],
    })
  })

  it("clears a finished upload task from the breadcrumb row", async () => {
    await render(<DriveModule />)

    const input = document.querySelector('input[type="file"]:not([webkitdirectory])')
    if (!(input instanceof HTMLInputElement)) throw new Error("File input not found")
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["report"], "report.txt", { type: "text/plain" })],
    })

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }))
      await flushPromises()
    })

    expect(document.body.textContent).toContain("已上传 1 项")
    await clickButtonText("清除")

    expect(document.body.textContent).not.toContain("已上传 1 项")
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
    await clickDriveRow("作业范文")
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

    await clickDriveRow("作业范文")
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
      taskId: expect.any(String),
      parentId: null,
      items: [{
        kind: "folder",
        folderName: "项目A",
        directories: [{ relativePath: "docs" }],
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
    await clickDriveRow("作业范文")
    await flushAct()

    const dropzone = getDriveDropzone()
    const file = new File(["drop"], "drop.txt", { type: "text/plain" })
    dispatchDragEvent(dropzone, "dragenter", createDataTransfer({ files: [file] }))

    expect(document.body.textContent).toContain("松开上传到 作业范文")

    dispatchDragEvent(dropzone, "drop", createDataTransfer({ files: [file] }))
    await flushAct()

    expect(mocks.uploadDriveLocalItems).toHaveBeenCalledWith({
      taskId: expect.any(String),
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
      taskId: expect.any(String),
      parentId: null,
      items: [
        { kind: "file", path: "/tmp/loose.txt", name: "loose.txt", mimeType: "text/plain" },
        {
          kind: "folder",
          folderName: "项目A",
          directories: [{ relativePath: "docs" }],
          files: [
            { path: "/tmp/a.md", relativePath: "a.md", mimeType: "text/markdown" },
            { path: "/tmp/b.md", relativePath: "docs/b.md", mimeType: null },
          ],
        },
      ],
    })
  })

  it("preserves empty directories when dropping folders", async () => {
    mocks.uploadDriveLocalItems.mockResolvedValueOnce({ completed: 0, completedDirectories: 4, failed: 0, skipped: 0 })
    await render(<DriveModule />)
    await flushAct()

    const dropzone = getDriveDropzone()
    dispatchDragEvent(dropzone, "drop", createDataTransfer({
      items: [
        createDirectoryTransferItem("项目A", [
          createDirectoryEntry("empty", []),
          createDirectoryEntry("nested", [
            createDirectoryEntry("leaf", []),
          ]),
        ]),
      ],
    }))
    await flushAct()

    expect(mocks.uploadDriveLocalItems).toHaveBeenCalledWith({
      taskId: expect.any(String),
      parentId: null,
      items: [{
        kind: "folder",
        folderName: "项目A",
        directories: [
          { relativePath: "empty" },
          { relativePath: "nested" },
          { relativePath: "nested/leaf" },
        ],
        files: [],
      }],
    })
    expect(mocks.toast).toHaveBeenCalledWith("已上传 4 个文件夹")
  })

  it("stops expanding dropped folders when the local upload file limit is reached", async () => {
    await render(<DriveModule />)
    await flushAct()

    const dropzone = getDriveDropzone()
    const fileEntries = Array.from({ length: DRIVE_LOCAL_UPLOAD_MAX_FILES + 1 }, (_, index) => (
      createFileEntry(`file-${index}.txt`, new File(["content"], `file-${index}.txt`, { type: "text/plain" }))
    ))

    dispatchDragEvent(dropzone, "drop", createDataTransfer({
      items: [
        createDirectoryTransferItem("bulk", fileEntries),
      ],
    }))
    await flushAct()

    expect(mocks.uploadDriveLocalItems).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith(
      `一次最多上传 ${DRIVE_LOCAL_UPLOAD_MAX_FILES} 个文件，请拆分后再上传。`,
      expect.objectContaining({ duration: 5000 }),
    )
  })

  it("counts files across multiple dropped folders before uploading", async () => {
    await render(<DriveModule />)
    await flushAct()

    const dropzone = getDriveDropzone()
    const fullFolderEntries = Array.from({ length: DRIVE_LOCAL_UPLOAD_MAX_FILES }, (_, index) => (
      createFileEntry(`first-${index}.txt`, new File(["content"], `first-${index}.txt`, { type: "text/plain" }))
    ))

    dispatchDragEvent(dropzone, "drop", createDataTransfer({
      items: [
        createDirectoryTransferItem("first", fullFolderEntries),
        createDirectoryTransferItem("second", [
          createFileEntry("overflow.txt", new File(["overflow"], "overflow.txt", { type: "text/plain" })),
        ]),
      ],
    }))
    await flushAct()

    expect(mocks.uploadDriveLocalItems).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith(
      `一次最多上传 ${DRIVE_LOCAL_UPLOAD_MAX_FILES} 个文件，请拆分后再上传。`,
      expect.objectContaining({ duration: 5000 }),
    )
  })

  it("shows cancel share as the shared row action", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({
        id: "file-1",
        name: "shared.txt",
        type: "file",
        shared: true,
        activeShareId: "share-row-1",
        activeShare: createDriveActiveShare({ expiresAt: driveShareExpiresInDays(3), passwordEnabled: true }),
      }),
    ])
    await render(<DriveModule />)
    await flushAct()

    expect(rowButton("shared.txt", "分享")).toBeUndefined()
    expect(rowButton("shared.txt", "取消分享")).not.toBeUndefined()

    await clickRowButtonText("shared.txt", "取消分享")

    expect(mocks.disableDriveShare).toHaveBeenCalledWith({ shareId: "share-row-1" })
    expect(mocks.toast).toHaveBeenCalledWith("已取消分享")
  })

  it("ignores duplicate cancel-share clicks from the file row", async () => {
    const disableShare = createDeferred<{ readonly ok: true }>()
    mocks.disableDriveShare.mockReturnValueOnce(disableShare.promise)
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({
        id: "file-1",
        name: "shared.txt",
        type: "file",
        shared: true,
        activeShareId: "share-row-1",
        activeShare: createDriveActiveShare({ expiresAt: driveShareExpiresInDays(3), passwordEnabled: true }),
      }),
    ])
    await render(<DriveModule />)
    await flushAct()

    const button = rowButton("shared.txt", "取消分享")
    if (!button) throw new Error("Cancel share button not found")
    await act(async () => {
      button.click()
      button.click()
      await flushPromises()
    })

    expect(mocks.disableDriveShare).toHaveBeenCalledTimes(1)
    expect(button.disabled).toBe(true)

    disableShare.resolve({ ok: true })
    await flushAct()

    expect(mocks.toast).toHaveBeenCalledWith("已取消分享")
  })

  it("opens existing share details from the shared summary", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({
        id: "folder-1",
        name: "文档",
        type: "folder",
        shared: true,
        activeShareId: "share-row-1",
        activeShare: createDriveActiveShare({
          expiresAt: driveShareExpiresInDays(3),
          passwordEnabled: true,
        }),
      }),
    ])
    mocks.getDriveShare.mockResolvedValue(createDriveShare({
      id: "share-row-1",
      itemId: "folder-1",
      itemName: "文档",
      itemType: "folder",
      shareId: "shr_folder",
      url: "https://synapse.test/share/shr_folder",
      urlWithPassword: "https://synapse.test/share/shr_folder?password=FolderPwd",
      password: "FolderPwd",
      expiresAt: "2026-06-20T05:18:52.000Z",
    }))
    await render(<DriveModule />)
    await flushAct()

    await clickInlineShareSummary("文档")

    expect(mocks.getDriveShare).toHaveBeenCalledWith({ shareId: "share-row-1" })
    expect(mocks.listDriveShares).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("文件夹已分享")
    expect(getShareUrlInput().value).toBe("https://synapse.test/share/shr_folder?password=FolderPwd")
    expect(document.body.textContent).toContain("FolderPwd")
    expect(getDialogFooterButtonTexts()).toEqual(["关闭"])
  })

  it("shares a file from the row action and shows the share URL actions", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", name: "report.txt", type: "file" }),
    ])
    await render(<DriveModule />)
    await flushAct()

    await clickButtonText("分享")
    expect(mocks.shareDriveItem).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("分享设置")
    expect(document.body.textContent).toContain("登录用户可编辑")
    expect(document.body.textContent).not.toContain("链接可编辑")
    expect(document.body.textContent).toContain("需要密码")
    expect(document.body.textContent).toContain("有效时长")
    expect(document.body.textContent).toContain("3 天")
    expect(getDialogContent().className).toContain("sm:max-w-lg")

    await clickButtonText("确定")

    expect(mocks.shareDriveItem).toHaveBeenCalledWith({
      itemId: "file-1",
      passwordEnabled: true,
      expiresIn: "3d",
      accessMode: "link_read",
      editorEmails: [],
    })
    expect(mocks.writeClipboardText).toHaveBeenCalledWith("https://synapse.test/share/shr_test?password=AbC234xy")
    expect(mocks.toast).toHaveBeenCalledWith("链接已复制")
    expect(document.body.textContent).toContain("文件已分享")
    expect(getDialogContent().className).toContain("sm:max-w-lg")
    expect(getShareUrlInput().value).toBe("https://synapse.test/share/shr_test?password=AbC234xy")
    expect(document.body.textContent).toContain("AbC234xy")
    expect(document.body.textContent).toMatch(/\d+ (?:分钟|小时|天|个月|年)前/)
    expect(getButton("复制链接").querySelector("svg")).toBeNull()
    expect(getButton("打开文件").querySelector("svg")).toBeNull()
    expect(queryButtonByLabel("复制密码")?.querySelector("svg")).toBeNull()
    expect(getDialogFooterButtonTexts()).toEqual(["关闭"])

    await clickButtonText("打开文件")
    expect(mocks.openExternal).toHaveBeenCalledWith("https://synapse.test/share/shr_test?password=AbC234xy")

    await clickButtonText("复制链接")
    expect(mocks.writeClipboardText).toHaveBeenLastCalledWith("https://synapse.test/share/shr_test?password=AbC234xy")
    expect(mocks.toast).toHaveBeenCalledWith("链接已复制")

    await clickButtonByLabel("复制密码")
    expect(mocks.writeClipboardText).toHaveBeenLastCalledWith("AbC234xy")
    expect(getDialogFooterButtonTexts()).toEqual(["关闭"])
  })

  it("keeps row actions focused on sharing, previewing, and deleting", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", name: "notes.md", type: "file", mimeType: "text/markdown" }),
    ])

    await render(<DriveModule />)
    await flushAct()

    expect(getButton("预览")).not.toBeNull()
    expect(getButton("分享")).not.toBeNull()
    expect(queryButton("取消分享")).toBeNull()
    expect(queryButton("打开")).toBeNull()
    expect(getButton("删除")).not.toBeNull()
    expect(getButton("更多").querySelector("svg")).toBeNull()
    expect(rowButton("notes.md", "删除")?.className).not.toContain("bg-destructive")
    expect(rowActions("notes.md")?.className).not.toContain("gap-")
    expect(rowButtonTexts("notes.md")).toEqual(["分享", "预览", "删除", "更多"])
    expect(actionColumnHeader()?.className).not.toContain("w-")
    expect(queryButtonByLabel("更多 notes.md")).not.toBeNull()
  })

  it("keeps trailing row actions aligned when share labels differ", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", name: "notes.md", type: "file" }),
      createDriveItem({ id: "file-2", name: "shared.md", type: "file", shared: true, activeShareId: "share-row-1" }),
    ])

    await render(<DriveModule />)
    await flushAct()

    expect(rowButtonTexts("notes.md")).toEqual(["分享", "预览", "删除", "更多"])
    expect(rowButtonTexts("shared.md")).toEqual(["取消分享", "预览", "删除", "更多"])
  })

  it("routes create actions through the top-bar new menu", async () => {
    await render(<DriveModule />)
    await flushAct()

    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]:not([webkitdirectory])')
    const folderInput = document.querySelector<HTMLInputElement>('input[type="file"][webkitdirectory]')
    if (!fileInput || !folderInput) throw new Error("Drive upload inputs not found")
    const fileInputClick = vi.spyOn(fileInput, "click")
    const folderInputClick = vi.spyOn(folderInput, "click")

    expect(getButton("新建").querySelector("svg")).toBeNull()
    expect(queryButton("上传文件")).toBeNull()
    expect(queryButton("上传文件夹")).toBeNull()

    await openDriveToolbarMenu("新建")
    await clickText("上传文件")
    expect(fileInputClick).toHaveBeenCalledTimes(1)

    await openDriveToolbarMenu("新建")
    await clickText("上传文件夹")
    expect(folderInputClick).toHaveBeenCalledTimes(1)
  })

  it("opens a file preview from the row action", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", name: "report.txt", type: "file" }),
    ])
    mocks.getDriveItemPreviewUrl.mockResolvedValue({ url: "https://synapse.test/drive/items/file-1" })
    await render(<DriveModule />)
    await flushAct()

    expect(getButton("预览").querySelector("svg")).toBeNull()

    await clickButtonText("预览")

    expect(mocks.getDriveItemPreviewUrl).toHaveBeenCalledWith({ itemId: "file-1" })
    expect(mocks.openExternal).toHaveBeenCalledWith("https://synapse.test/drive/items/file-1")
  })

  it("opens a folder preview without entering the desktop folder row", async () => {
    mocks.listDriveItems
      .mockResolvedValueOnce([
        createDriveItem({ id: "folder-1", name: "site", type: "folder" }),
      ])
      .mockResolvedValueOnce([
        createDriveItem({ id: "nested-1", name: "nested.txt", type: "file", parentId: "folder-1" }),
      ])
    mocks.getDriveItemPreviewUrl.mockResolvedValue({ url: "https://synapse.test/drive/items/folder-1" })
    await render(<DriveModule />)
    await flushAct()

    await clickButtonText("预览")

    expect(mocks.getDriveItemPreviewUrl).toHaveBeenCalledWith({ itemId: "folder-1" })
    expect(mocks.openExternal).toHaveBeenCalledWith("https://synapse.test/drive/items/folder-1")
    expect(document.body.textContent).toContain("site")
    expect(document.body.textContent).not.toContain("nested.txt")
  })

  it("shows a toast when opening a row preview fails", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", name: "report.txt", type: "file" }),
    ])
    mocks.getDriveItemPreviewUrl.mockRejectedValue(new Error("preview url failed"))
    await render(<DriveModule />)
    await flushAct()

    await clickButtonText("预览")

    expect(mocks.openExternal).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith("打开失败")
  })

  it("closes the access settings dialog before waiting for clipboard copy", async () => {
    const clipboardWrite = createDeferred<void>()
    mocks.writeClipboardText.mockReturnValueOnce(clipboardWrite.promise)
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", name: "report.txt", type: "file" }),
    ])
    await render(<DriveModule />)
    await flushAct()

    await clickButtonText("分享")
    await clickButtonText("确定")

    expect(document.body.textContent).not.toContain("分享设置")
    expect(document.body.textContent).toContain("文件已分享")
    expect(getShareUrlInput().value).toBe("https://synapse.test/share/shr_test?password=AbC234xy")

    clipboardWrite.resolve()
    await flushAct()
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
      url: "https://synapse.test/share/shr_folder",
      urlWithPassword: "https://synapse.test/share/shr_folder?password=AbC234xy",
      passwordEnabled: true,
      password: "AbC234xy",
      expiresAt: "2026-06-14T00:00:00.000Z",
      accessMode: "link_read",
      editorEmails: [],
      createdAt: "2026-06-07T00:00:00.000Z",
    })
    await render(<DriveModule />)
    await flushAct()

    await clickButtonText("分享")
    expect(mocks.shareDriveItem).not.toHaveBeenCalled()

    await clickButtonText("确定")

    expect(mocks.shareDriveItem).toHaveBeenCalledWith({
      itemId: "folder-1",
      ...DRIVE_DEFAULT_ACCESS_SETTINGS,
    })
    expect(mocks.writeClipboardText).toHaveBeenCalledWith("https://synapse.test/share/shr_folder?password=AbC234xy")
    expect(document.body.textContent).toContain("文件夹已分享")
    expect(getDialogContent().className).toContain("sm:max-w-lg")
    expect(getShareUrlInput().value).toBe("https://synapse.test/share/shr_folder?password=AbC234xy")
    expect(getDialogFooterButtonTexts()).toEqual(["关闭"])

    await clickButtonText("打开文件夹")
    expect(mocks.openExternal).toHaveBeenCalledWith("https://synapse.test/share/shr_folder?password=AbC234xy")
  })

  it("shows the shared URL when automatic clipboard copy fails", async () => {
    mocks.writeClipboardText.mockRejectedValueOnce(new Error("clipboard denied"))
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", name: "report.txt", type: "file" }),
    ])
    await render(<DriveModule />)
    await flushAct()

    await clickButtonText("分享")
    await clickButtonText("确定")

    expect(mocks.shareDriveItem).toHaveBeenCalledWith({
      itemId: "file-1",
      ...DRIVE_DEFAULT_ACCESS_SETTINGS,
    })
    expect(mocks.toast).toHaveBeenCalledWith("分享成功，复制失败")
    expect(document.body.textContent).toContain("文件已分享")
    expect(getShareUrlInput().value).toBe("https://synapse.test/share/shr_test?password=AbC234xy")
  })

  it("renders row menu items without icons and keeps deletion outside the menu", async () => {
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
    await render(<DriveModule />)
    await flushAct()

    await openRowMenu("report.html")

    const menu = document.body.querySelector<HTMLElement>("[role='menu']")
    expect(menu).not.toBeNull()
    expect(menu?.querySelectorAll("[role='menuitem'] svg")).toHaveLength(0)
    expect(menu?.querySelectorAll("[role='separator']")).toHaveLength(0)
    expect(menuItemTexts()).toEqual([
      "同步",
      "重命名",
      "移动",
    ])
    expect(rowButton("report.html", "删除")).not.toBeUndefined()
  })

  it("keeps row management actions in the more menu without duplicate share", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", name: "shared.txt", type: "file", shared: true, activeShareId: "share-row-1" }),
    ])
    await render(<DriveModule />)
    await flushAct()

    await openFirstMenu()

    expect(menuItemTexts()).toEqual(["同步", "重命名", "移动"])
    expect(rowButton("shared.txt", "删除")).not.toBeUndefined()
  })

  it("opens an in-app confirmation before deleting an item", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", name: "report.txt", type: "file" }),
    ])
    await render(<DriveModule />)
    await flushAct()

    await clickRowButtonText("report.txt", "删除")

    expect(document.body.textContent).toContain("确认删除")
    expect(document.body.textContent).toContain("report.txt")
    expect(mocks.deleteDriveItem).not.toHaveBeenCalled()

    await clickAlertDialogButton("删除")

    expect(mocks.deleteDriveItem).toHaveBeenCalledWith({ itemId: "file-1" })
    expect(mocks.toast).toHaveBeenCalledWith("已删除")
    expect(mocks.getDriveUsage).toHaveBeenCalledTimes(2)
  })

  it("deletes an item immediately when Alt-clicking delete", async () => {
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", name: "report.txt", type: "file" }),
    ])
    await render(<DriveModule />)
    await flushAct()

    await clickRowButtonText("report.txt", "删除", { altKey: true })

    expect(document.body.textContent).not.toContain("确认删除")
    expect(mocks.deleteDriveItem).toHaveBeenCalledWith({ itemId: "file-1" })
    expect(mocks.toast).toHaveBeenCalledWith("已删除")
  })

  it("ignores repeated Alt-click deletes while the item is pending", async () => {
    const deletion = createDeferred<void>()
    mocks.listDriveItems.mockResolvedValue([
      createDriveItem({ id: "file-1", name: "report.txt", type: "file" }),
    ])
    mocks.deleteDriveItem.mockReturnValueOnce(deletion.promise)
    await render(<DriveModule />)
    await flushAct()

    const deleteButton = rowButton("report.txt", "删除")
    if (!deleteButton) throw new Error("Delete button not found")
    await act(async () => {
      deleteButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true }))
      deleteButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true }))
      await flushPromises()
    })

    expect(mocks.deleteDriveItem).toHaveBeenCalledTimes(1)
    expect(rowButton("report.txt", "删除")?.disabled).toBe(true)

    deletion.resolve()
    await flushAct()
  })

  it("defaults public link management to the share list without publication tabs", async () => {
    mocks.listDriveShares.mockResolvedValue(createDrivePublicLinksPage([
      createDriveShare({ id: "share-row-1", shareId: "shr_test", itemName: "report.txt", itemType: "file" }),
      createDriveShare({ id: "share-row-2", shareId: "shr_folder", itemName: "folder", itemType: "folder" }),
    ]))
    await render(<DriveModule />)
    await flushAct()

    await clickDriveToolbarMenuItem("更多", "我的分享")
    await flushAct()

    const dialogContent = document.querySelector('[data-slot="dialog-content"]')
    if (!dialogContent) throw new Error("Public links dialog not found")
    expect(dialogContent?.className).toContain("sm:max-w-4xl")
    expect(dialogContent?.className).toContain("h-[36rem]")
    const dialogHeader = document.querySelector('[role="dialog"] [data-slot="dialog-frame-header"]')
    if (!dialogHeader) throw new Error("Public links dialog header not found")
    expect(Array.from(dialogHeader.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent)).toEqual([
      "文件",
      "文件夹",
    ])
    expect(document.body.textContent).not.toContain("全部")
    expect(document.body.textContent).toContain("report.txt")
    expect(document.body.textContent).not.toContain("folder")
    expect(document.body.textContent).not.toContain("发布")
    const testHeader = document.querySelector('[data-testid="drive-public-links-dialog-header"]')
    expect(testHeader?.className).toContain("px-5")
    const tabsHeader = document.querySelector('[data-testid="drive-public-links-tabs-header"]')
    expect(tabsHeader).toBeNull()
    expect(tableContainer()?.className).not.toContain("overflow-x-hidden")
    expect(tableColumnClasses(dialogContent)).toEqual(["w-72", "w-auto", "w-44"])
  })

  it("filters public links by file and folder tabs", async () => {
    mocks.listDriveShares.mockResolvedValue(createDrivePublicLinksPage([
      createDriveShare({ id: "share-file", shareId: "shr_file", itemName: "notes.md", itemType: "file" }),
      createDriveShare({ id: "share-folder", shareId: "shr_folder", itemName: "docs", itemType: "folder" }),
    ]))

    await render(<DriveModule />)
    await flushAct()
    await clickDriveToolbarMenuItem("更多", "我的分享")
    await flushAct()

    const dialog = document.querySelector('[role="dialog"]')
    if (!dialog) throw new Error("Public links dialog not found")
    expect(dialog.textContent).toContain("notes.md")
    expect(dialog.textContent).not.toContain("docs")

    await clickTabText("文件夹")
    expect(dialog.textContent).not.toContain("notes.md")
    expect(dialog.textContent).toContain("docs")

    await clickTabText("文件")
    expect(dialog.textContent).toContain("notes.md")
    expect(dialog.textContent).not.toContain("docs")
  })

  it("loads additional share pages until the active type is found", async () => {
    mocks.listDriveShares
      .mockResolvedValueOnce(createDrivePublicLinksPage([
        createDriveShare({ id: "share-folder", shareId: "shr_folder", itemName: "docs", itemType: "folder" }),
      ], { hasMore: true, nextOffset: 1 }))
      .mockResolvedValueOnce(createDrivePublicLinksPage([
        createDriveShare({ id: "share-file", shareId: "shr_file", itemName: "notes.md", itemType: "file" }),
      ]))

    await render(<DriveModule />)
    await flushAct()
    await clickDriveToolbarMenuItem("更多", "我的分享")
    await flushAct()

    expect(mocks.listDriveShares).toHaveBeenNthCalledWith(1, { offset: 0, limit: 20 })
    expect(mocks.listDriveShares).toHaveBeenNthCalledWith(2, { offset: 1, limit: 20 })
    expect(document.body.textContent).toContain("notes.md")
    expect(document.body.textContent).not.toContain("暂无分享")
  })

  it("loads share data in the public links dialog", async () => {
    mocks.listDriveShares.mockResolvedValue(createDrivePublicLinksPage([
      createDriveShare({ id: "share-1", itemName: "notes.md", itemType: "file" }),
    ]))

    await render(<DriveModule />)
    await flushAct()

    await clickDriveToolbarMenuItem("更多", "我的分享")
    await flushAct()

    expect(mocks.listDriveShares).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain("notes.md")
  })

  it("manages shares from the public links dialog", async () => {
    mocks.listDriveShares.mockResolvedValue(createDrivePublicLinksPage([
      createDriveShare({ id: "share-row-1", shareId: "shr_test", itemName: "report.txt", itemType: "file" }),
      createDriveShare({ id: "share-row-2", shareId: "shr_folder", itemName: "folder", itemType: "folder", sourceDeleted: true, url: "https://synapse.test/share/shr_folder" }),
    ]))
    await render(<DriveModule />)
    await flushAct()

    await clickDriveToolbarMenuItem("更多", "我的分享")
    await flushAct()

    expect(document.body.textContent).toContain("report.txt")
    expect(document.body.textContent).toContain("链接信息")
    expect(document.body.textContent).toContain("密码")
    expect(document.body.textContent).toContain("到期")
    expect(document.body.textContent).toContain("时间")
    expect(document.body.textContent).toContain("操作")
    expect(document.body.textContent).toContain("文件")
    expect(document.body.textContent).toMatch(/\d+ (?:分钟|小时|天|个月|年)前/)
    expect(document.body.textContent).toContain("来源正常")
    expect(document.body.textContent).not.toContain("folder")

    await clickTabText("文件夹")
    expect(document.body.textContent).toContain("folder")
    expect(document.body.textContent).toContain("文件夹")
    expect(document.body.textContent).toContain("来源已删除")
    expect(queryButtonByLabel("复制 folder")).toBeNull()
    expect(queryButtonByLabel("复制 folder 密码")).toBeNull()
    expect(queryButtonByLabel("打开 folder")).toBeNull()
    expect(queryButtonByLabel("取消分享 folder")).not.toBeNull()

    await clickTabText("文件")
    await clickButtonByLabel("复制 report.txt")
    expect(mocks.writeClipboardText).toHaveBeenCalledWith("https://synapse.test/share/shr_test?password=AbC234xy")
    expect(mocks.toast).toHaveBeenCalledWith("链接已复制")

    await clickButtonByLabel("复制 report.txt 密码")
    expect(mocks.writeClipboardText).toHaveBeenLastCalledWith("AbC234xy")

    await clickButtonByLabel("打开 report.txt")
    expect(mocks.openExternal).toHaveBeenCalledWith("https://synapse.test/share/shr_test?password=AbC234xy")

    await clickButtonByLabel("取消分享 report.txt")

    expect(mocks.listDriveShares).toHaveBeenCalled()
    expect(mocks.listDriveShares).toHaveBeenCalledTimes(2)
    expect(mocks.disableDriveShare).toHaveBeenCalledWith({ shareId: "share-row-1" })
    expect(mocks.toast).toHaveBeenCalledWith("已取消分享")
  })

  it("ignores duplicate cancel-share clicks from the public links dialog", async () => {
    const disableShare = createDeferred<{ readonly ok: true }>()
    mocks.disableDriveShare.mockReturnValueOnce(disableShare.promise)
    mocks.listDriveShares.mockResolvedValue(createDrivePublicLinksPage([
      createDriveShare({ id: "share-row-1", shareId: "shr_test", itemName: "report.txt", itemType: "file" }),
    ]))
    await render(<DriveModule />)
    await flushAct()

    await clickDriveToolbarMenuItem("更多", "我的分享")
    await flushAct()
    const button = getButtonByLabel("取消分享 report.txt")
    await act(async () => {
      button.click()
      button.click()
      await flushPromises()
    })

    expect(mocks.disableDriveShare).toHaveBeenCalledTimes(1)
    expect(button.disabled).toBe(true)

    disableShare.resolve({ ok: true })
    await flushAct()

    expect(mocks.toast).toHaveBeenCalledWith("已取消分享")
  })

  it("refreshes the main list after disabling a share from the public links dialog", async () => {
    let driveItems = [
      createDriveItem({
        id: "file-1",
        name: "report.txt",
        type: "file",
        shared: true,
        activeShareId: "share-row-1",
        activeShare: createDriveActiveShare({ expiresAt: driveShareExpiresInDays(3), passwordEnabled: true }),
      }),
    ]
    mocks.listDriveItems.mockImplementation(() => Promise.resolve(driveItems))
    mocks.listDriveShares.mockResolvedValue(createDrivePublicLinksPage([
      createDriveShare({ id: "share-row-1", shareId: "shr_test", itemName: "report.txt", itemType: "file" }),
    ]))
    mocks.disableDriveShare.mockImplementation(async () => {
      driveItems = [createDriveItem({ id: "file-1", name: "report.txt", type: "file", shared: false, activeShareId: null })]
      return { ok: true }
    })
    await render(<DriveModule />)
    await flushAct()

    expect(getTableRow("report.txt").textContent).toContain("分享：3天 · 密码 · 可阅读")

    await clickDriveToolbarMenuItem("更多", "我的分享")
    await flushAct()
    await clickButtonByLabel("取消分享 report.txt")
    await clickButtonText("关闭")

    expect(getTableRow("report.txt").textContent).not.toContain("分享：")
  })

  it("shows share loading, empty, and retry states in the public links dialog", async () => {
    const shares = createDeferred<DrivePublicLinksPageDto<DriveShareListItemDto>>()
    await render(<DriveModule />)
    await flushAct()

    mocks.listDriveShares.mockReturnValueOnce(shares.promise)
    await clickDriveToolbarMenuItem("更多", "我的分享")

    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull()

    await act(async () => {
      shares.resolve(createDrivePublicLinksPage([]))
      await flushPromises()
    })
    await flushAct()

    expect(document.body.textContent).toContain("暂无分享")

    mocks.listDriveShares
      .mockRejectedValueOnce(new Error("分享列表加载失败。"))
      .mockResolvedValueOnce(createDrivePublicLinksPage([]))

    await clickButtonText("关闭")
    await clickDriveToolbarMenuItem("更多", "我的分享")
    await flushAct()

    expect(document.body.textContent).toContain("读取失败")
    expect(document.body.textContent).toContain("分享列表加载失败。")

    await clickButtonText("重试")
    await flushAct()

    expect(mocks.listDriveShares).toHaveBeenCalledTimes(3)
    expect(document.body.textContent).toContain("暂无分享")
  })

  it("ignores stale share load-more responses after reopening the public links dialog", async () => {
    const oldLoadMore = createDeferred<DrivePublicLinksPageDto<DriveShareListItemDto>>()
    mocks.listDriveShares
      .mockResolvedValueOnce(createDrivePublicLinksPage([
        createDriveShare({ id: "share-1", itemName: "first-round.txt", shareId: "shr_first" }),
      ], { hasMore: true, nextOffset: 1 }))
      .mockReturnValueOnce(oldLoadMore.promise)
      .mockResolvedValueOnce(createDrivePublicLinksPage([
        createDriveShare({ id: "share-2", itemName: "second-round.txt", shareId: "shr_second" }),
      ]))

    await render(<DriveModule />)
    await flushAct()

    await clickDriveToolbarMenuItem("更多", "我的分享")
    await flushAct()
    await clickButtonText("加载更多")
    await clickButtonText("关闭")
    await clickDriveToolbarMenuItem("更多", "我的分享")
    await flushAct()

    expect(document.body.textContent).toContain("second-round.txt")

    await act(async () => {
      oldLoadMore.resolve(createDrivePublicLinksPage([
        createDriveShare({ id: "share-old", itemName: "stale-page.txt", shareId: "shr_stale" }),
      ]))
      await flushPromises()
    })
    await flushAct()

    expect(document.body.textContent).toContain("second-round.txt")
    expect(document.body.textContent).not.toContain("stale-page.txt")
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

  it("loads additional move target folders on demand", async () => {
    mocks.listDriveItems.mockImplementation(async (input: { parentId?: string | null; offset?: number; limit?: number } = {}) => {
      if ((input.parentId ?? null) === null && input.offset === 100) {
        return createDriveItemPage([
          createDriveItem({ id: "folder-2", name: "第二页目录", type: "folder" }),
        ], { offset: 100, limit: 100, hasMore: false, nextOffset: null })
      }
      return createDriveItemPage([
        createDriveItem({ id: "file-1", name: "report.txt", type: "file" }),
        createDriveItem({ id: "folder-1", name: "第一页目录", type: "folder" }),
      ], { offset: 0, limit: 100, hasMore: true, nextOffset: 100 })
    })

    await render(<DriveModule />)
    await flushAct()

    await openFirstMenu()
    await clickText("移动")
    await flushAct()

    expect(document.body.textContent).toContain("第一页目录")
    expect(document.body.textContent).not.toContain("第二页目录")

    await clickButtonByLabel("加载更多 根目录")
    await flushAct()

    expect(mocks.listDriveItems).toHaveBeenLastCalledWith({ parentId: null, offset: 100, limit: 100 })
    expect(document.body.textContent).toContain("第二页目录")
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

function emitDriveLocalUploadProgress(event: DriveLocalUploadProgressEvent) {
  if (!driveUploadProgressListener) throw new Error("Upload progress listener not registered")
  driveUploadProgressListener(event)
}

function lastUploadTaskId(): string {
  const input = mocks.uploadDriveLocalItems.mock.calls.at(-1)?.[0] as { readonly taskId?: string } | undefined
  if (!input?.taskId) throw new Error("No upload task id recorded")
  return input.taskId
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

function queryExactButton(name: string): HTMLButtonElement | null {
  const button = Array.from(document.querySelectorAll("button"))
    .find((element) => element.textContent?.trim() === name)
  return button instanceof HTMLButtonElement ? button : null
}

function menuItemTexts(): string[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>("[role='menuitem']"))
    .map((element) => element.textContent?.trim() ?? "")
}

function tableHeaderTexts(): string[] {
  return Array.from(document.body.querySelectorAll<HTMLTableCellElement>("thead th"))
    .map((element) => element.textContent?.trim() ?? "")
}

function actionColumnHeader(): HTMLTableCellElement | undefined {
  return Array.from(document.body.querySelectorAll<HTMLTableCellElement>("thead th"))
    .find((element) => element.getAttribute("aria-label") === "操作")
}

function tableContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="table-container"]')
}

function tableColumnClasses(scope: ParentNode = document.body): string[] {
  return Array.from(scope.querySelectorAll<HTMLTableColElement>("colgroup col"))
    .map((element) => element.className)
}

function driveToolbarButtons(): HTMLButtonElement[] {
  const toolbar = document.querySelector<HTMLElement>('[data-testid="drive-toolbar-actions"]')
  if (!toolbar) throw new Error("Drive toolbar actions not found")
  return Array.from(toolbar.querySelectorAll<HTMLButtonElement>("button"))
}

function driveToolbarActionLabels(): string[] {
  return driveToolbarButtons().map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "")
}

function getTableRow(text: string): HTMLTableRowElement {
  const row = Array.from(document.body.querySelectorAll<HTMLTableRowElement>("tbody tr"))
    .find((candidate) => candidate.textContent?.includes(text))
  if (!row) throw new Error(`Table row not found: ${text}`)
  return row
}

function driveItemNameElement(text: string): HTMLElement {
  const element = getTableRow(text).querySelector<HTMLElement>(`[title="${text}"]`)
  if (!element) throw new Error(`Drive item name not found: ${text}`)
  return element
}

function selectElementText(element: HTMLElement): void {
  const textNode = Array.from(element.childNodes).find((node) => node.nodeType === Node.TEXT_NODE)
  if (!textNode) throw new Error("Selectable text node not found")
  const range = document.createRange()
  range.selectNodeContents(textNode)
  const selection = window.getSelection()
  if (!selection) throw new Error("Selection API not available")
  selection.removeAllRanges()
  selection.addRange(range)
}

function rowButton(rowText: string, buttonText: string): HTMLButtonElement | undefined {
  return Array.from(getTableRow(rowText).querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.trim() === buttonText)
}

function rowButtonTexts(rowText: string): string[] {
  return Array.from(getTableRow(rowText).querySelectorAll<HTMLButtonElement>("td:last-child button"))
    .map((button) => button.textContent?.trim() ?? "")
}

function rowActions(rowText: string): HTMLElement | null {
  return getTableRow(rowText).querySelector<HTMLElement>("td:last-child > div")
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
    const trigger = document.querySelector('button[aria-label^="更多 "]')
    if (!(trigger instanceof HTMLButtonElement)) throw new Error("More menu button not found")
    trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    await flushPromises()
  })
}

async function openDriveToolbarMenu(label: string): Promise<void> {
  await act(async () => {
    const trigger = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
      .find((candidate) => candidate.getAttribute("aria-label") === label || candidate.textContent?.trim() === label)
    if (!trigger) throw new Error(`Drive toolbar menu button not found: ${label}`)
    trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    await flushPromises()
  })
}

async function clickDriveToolbarMenuItem(menuLabel: string, itemText: string): Promise<void> {
  await openDriveToolbarMenu(menuLabel)
  await clickMenuItemText(itemText)
}

function getMenuItem(text: string): HTMLElement {
  const item = Array.from(document.body.querySelectorAll<HTMLElement>("[role='menuitem']"))
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!item) throw new Error(`Menu item not found: ${text}`)
  return item
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

async function openDriveNameContextMenu(name: string): Promise<void> {
  const target = driveItemNameElement(name)
  await act(async () => {
    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }))
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

async function hoverElement(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    element.dispatchEvent(new MouseEvent("pointerenter", { bubbles: false }))
    element.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }))
    element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }))
    await flushPromises()
  })
}

async function textAreaInput(id: string, value: string): Promise<void> {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLTextAreaElement)) throw new Error(`Textarea not found: ${id}`)
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
    setter?.call(element, value)
    element.dispatchEvent(new Event("input", { bubbles: true }))
    await flushPromises()
  })
}

async function clickDriveRow(rowText: string): Promise<void> {
  const row = getTableRow(rowText)
  await act(async () => {
    row.click()
    await flushPromises()
  })
}

async function clickRowButtonText(rowText: string, buttonText: string, eventInit: MouseEventInit = {}): Promise<void> {
  const element = rowButton(rowText, buttonText)
  if (!element) throw new Error(`Button not found in row ${rowText}: ${buttonText}`)
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...eventInit }))
    await flushPromises()
  })
}

async function clickInlineShareSummary(rowText: string): Promise<void> {
  const element = Array.from(getTableRow(rowText).querySelectorAll<HTMLButtonElement>("td:first-child button"))
    .find((button) => button.textContent?.includes("分享："))
  if (!element) throw new Error(`Share summary not found in row ${rowText}`)
  await act(async () => {
    element.click()
    await flushPromises()
  })
}

async function clickTabText(text: string): Promise<void> {
  const element = Array.from(document.body.querySelectorAll<HTMLButtonElement>("[role='tab']"))
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!element) throw new Error(`Tab not found: ${text}`)
  await act(async () => {
    element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    element.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }))
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

async function clickMenuItemText(text: string): Promise<void> {
  const element = Array.from(document.body.querySelectorAll<HTMLElement>("[role='menuitem']"))
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!element) throw new Error(`Menu item not found: ${text}`)
  await act(async () => {
    element.click()
    await flushPromises()
  })
}

async function clickButtonByLabel(label: string): Promise<void> {
  const button = queryButtonByLabel(label)
  if (!button) throw new Error(`Button not found: ${label}`)
  await act(async () => {
    button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    button.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }))
    button.click()
    await flushPromises()
  })
}

function queryButtonByLabel(label: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
}

function getButtonByLabel(label: string): HTMLButtonElement {
  const button = queryButtonByLabel(label)
  if (!button) throw new Error(`Button not found: ${label}`)
  return button
}

function getShareUrlInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>("#drive-share-success-url")
  if (!input) throw new Error("Share URL input not found")
  return input
}

function getSiteCreatedUrlInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>("#drive-site-created-url")
  if (!input) throw new Error("Site URL input not found")
  return input
}

function getSiteCreatedPasswordInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>("#drive-site-created-password")
  if (!input) throw new Error("Site password input not found")
  return input
}

function getDialogContent(): HTMLElement {
  const content = document.querySelector<HTMLElement>('[data-slot="dialog-content"]')
  if (!content) throw new Error("Dialog content not found")
  return content
}

function getDialogFooterButtonTexts(): string[] {
  const footer = document.querySelector<HTMLElement>('[data-slot="dialog-footer"], [data-slot="dialog-frame-footer"]')
  if (!footer) throw new Error("Dialog footer not found")
  return Array.from(footer.querySelectorAll<HTMLButtonElement>("button"))
    .map((button) => button.textContent?.trim() ?? "")
}

function createDriveItem(overrides: Partial<DriveItemDto> = {}): DriveItemDto {
  return {
    activeShare: null,
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

function createDriveItemPage(
  items: readonly DriveItemDto[],
  page: Partial<DriveItemListPageDto["page"]> = {},
): DriveItemListPageDto {
  return {
    items,
    page: {
      offset: 0,
      limit: 100,
      hasMore: false,
      nextOffset: null,
      ...page,
    },
  }
}

function createDriveActiveShare(overrides: Partial<NonNullable<DriveItemDto["activeShare"]>> = {}): NonNullable<DriveItemDto["activeShare"]> {
  return {
    accessMode: "link_read",
    editorCount: 0,
    expiresAt: null,
    id: "share-row-1",
    passwordEnabled: false,
    ...overrides,
  }
}

function driveShareExpiresInDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString()
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
    url: "https://synapse.test/share/shr_test",
    urlWithPassword: "https://synapse.test/share/shr_test?password=AbC234xy",
    passwordEnabled: true,
    password: "AbC234xy",
    expiresAt: "2026-06-14T00:00:00.000Z",
    accessMode: "link_read",
    editorEmails: [],
    ...overrides,
  }
}

function createDriveSite(overrides: Partial<DriveSiteDto> = {}): DriveSiteDto {
  return {
    id: "site-row-1",
    siteId: "site_abc",
    name: "原型",
    status: "active",
    accessMode: "public",
    url: "https://synapse.test/sites/site_abc/",
    urlWithPassword: "https://synapse.test/sites/site_abc/",
    passwordEnabled: false,
    password: null,
    expiresIn: "forever",
    expiresAt: null,
    sourceFolderItemId: "folder-1",
    sourceFolderName: "原型",
    entryPath: "index.html",
    fileCount: 3,
    totalBytes: "128",
    createdAt: "2026-06-23T00:00:00.000Z",
    updatedAt: "2026-06-23T00:00:00.000Z",
    lastPublishedAt: "2026-06-23T00:00:00.000Z",
    ...overrides,
  }
}

function createDrivePublicLinksPage<TItem>(
  items: readonly TItem[],
  page: Partial<DrivePublicLinksPageDto<TItem>["page"]> = {},
): DrivePublicLinksPageDto<TItem> {
  return {
    items,
    page: {
      offset: 0,
      limit: 20,
      hasMore: false,
      nextOffset: null,
      ...page,
    },
  }
}

function createDriveSitePage(
  items: readonly DriveSiteDto[],
  page: Partial<DriveSiteListPageDto["page"]> = {},
): DriveSiteListPageDto {
  return {
    items,
    total: items.length,
    page: {
      offset: 0,
      limit: 50,
      hasMore: false,
      nextOffset: null,
      ...page,
    },
  }
}

function createDrivePublicAssetPage(
  items: readonly DrivePublicAssetDto[],
  page: Partial<DrivePublicAssetListPageDto["page"]> = {},
): DrivePublicAssetListPageDto {
  return {
    items,
    total: items.length,
    page: {
      offset: 0,
      limit: 50,
      hasMore: false,
      nextOffset: null,
      ...page,
    },
  }
}

function createDriveTrashPage(
  items: DriveTrashListPageDto["items"],
  page: Partial<DriveTrashListPageDto["page"]> = {},
): DriveTrashListPageDto {
  return {
    items,
    total: items.length,
    page: {
      offset: 0,
      limit: 50,
      hasMore: false,
      nextOffset: null,
      ...page,
    },
  }
}

function createDriveSyncSnapshot(
  summary: Partial<DriveSyncSnapshotDto["summary"]> = {},
  entries: {
    readonly bindings?: DriveSyncSnapshotDto["bindings"]
    readonly conflicts?: readonly DriveSyncConflictFixture[]
    readonly operations?: DriveSyncSnapshotDto["operations"]
    readonly health?: DriveSyncSnapshotDto["health"]
  } = {},
): DriveSyncSnapshotDto {
  const nextSummary = {
    activeBindingCount: 0,
    runningOperationCount: 0,
    conflictCount: 0,
    errorCount: 0,
    ...summary,
  }
  return {
    bindings: entries.bindings ?? [],
    conflicts: (entries.conflicts ?? []).map((conflict) => ({
      ...conflict,
      localSummary: conflict.localSummary ?? null,
      remoteSummary: conflict.remoteSummary ?? null,
      availableActions: conflict.availableActions ?? defaultConflictActions(conflict.type),
    })),
    operations: entries.operations ?? [],
    health: entries.health ?? {
      status: "idle",
      lastError: null,
      updatedAt: "2026-06-28T00:00:00.000Z",
    },
    summary: nextSummary,
  }
}

type DriveSyncConflictFixture =
  Omit<DriveSyncSnapshotDto["conflicts"][number], "availableActions" | "localSummary" | "remoteSummary">
  & Partial<Pick<DriveSyncSnapshotDto["conflicts"][number], "availableActions" | "localSummary" | "remoteSummary">>

function defaultConflictActions(type: string): DriveSyncSnapshotDto["conflicts"][number]["availableActions"] {
  return type === "delete_vs_modify"
    ? ["confirm_delete", "skip"]
    : ["keep_local", "keep_remote", "keep_both", "skip"]
}

function createDriveSyncBinding(input: Partial<DriveSyncSnapshotDto["bindings"][number]> = {}): DriveSyncSnapshotDto["bindings"][number] {
  return {
    id: "binding-1",
    driveItemId: "drive-root",
    driveItemName: "Docs",
    drivePathHint: null,
    kind: "folder",
    localPath: "/Users/me/Docs",
    status: "active",
    remoteCursor: "42",
    excludeRules: {
      forced: [".git/**", ".git"],
      defaults: [],
      importedGitignore: [],
      user: ["node_modules/**"],
    },
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
    lastSyncedAt: null,
    lastError: null,
    ...input,
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
        handle: "ada",
      },
      teams: [],
      syncedAt: "2026-06-01T00:00:00.000Z",
    },
  }
}
