/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION, type DrivePublicAssetDto, type DrivePublicAssetListPageDto } from "@synapse/shared"

import { DrivePublicAssetsView } from "../drive-public-assets-view"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  deleteDriveTrashItem: vi.fn(),
  filePathForDroppedFile: vi.fn(),
  listDrivePublicAssets: vi.fn(),
  renameDrivePublicAsset: vi.fn(),
  replaceDrivePublicAssetFile: vi.fn(),
  restoreDrivePublicAsset: vi.fn(),
  toast: vi.fn(),
  trashDrivePublicAsset: vi.fn(),
  uploadDrivePublicAssets: vi.fn(),
  writeClipboardText: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: mocks.toast,
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => ({
    account: {
      deleteDriveTrashItem: mocks.deleteDriveTrashItem,
      filePathForDroppedFile: mocks.filePathForDroppedFile,
      listDrivePublicAssets: mocks.listDrivePublicAssets,
      renameDrivePublicAsset: mocks.renameDrivePublicAsset,
      replaceDrivePublicAssetFile: mocks.replaceDrivePublicAssetFile,
      restoreDrivePublicAsset: mocks.restoreDrivePublicAsset,
      trashDrivePublicAsset: mocks.trashDrivePublicAsset,
      uploadDrivePublicAssets: mocks.uploadDrivePublicAssets,
    },
  }),
}))

let roots: Root[] = []

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.writeClipboardText },
  })
  mocks.deleteDriveTrashItem.mockResolvedValue({ ok: true })
  mocks.filePathForDroppedFile.mockImplementation((file: File) => `/tmp/${file.name}`)
  mocks.listDrivePublicAssets.mockResolvedValue(createPublicAssetPage([]))
  mocks.renameDrivePublicAsset.mockResolvedValue(createPublicAsset({ name: "renamed.png" }))
  mocks.replaceDrivePublicAssetFile.mockResolvedValue(createPublicAsset({ name: "replacement.png" }))
  mocks.restoreDrivePublicAsset.mockResolvedValue(createPublicAsset())
  mocks.trashDrivePublicAsset.mockResolvedValue(createPublicAsset({ lifecycleStatus: "trashed" }))
  mocks.uploadDrivePublicAssets.mockResolvedValue({ results: [] })
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
  vi.resetAllMocks()
})

describe("DrivePublicAssetsView", () => {
  it("lists public assets and copies links", async () => {
    mocks.listDrivePublicAssets.mockResolvedValue(createPublicAssetPage([
      createPublicAsset({
        assetId: "asset_public",
        name: "brand.png",
        url: "https://synapse.test/files/asset_public",
        size: "1536",
        accessCount: "7",
        lastAccessedAt: "2026-06-10T00:00:00.000Z",
      }),
    ]))

    await render(<DrivePublicAssetsView />)
    await flushAct()

    expect(mocks.listDrivePublicAssets).toHaveBeenCalledWith({ offset: 0, limit: 50 })
    expect(document.body.textContent).toContain("公开素材")
    expect(document.body.textContent).toContain("brand.png")
    expect(document.body.textContent).toContain("image/png")
    expect(document.body.textContent).toContain("1.5 KB")
    expect(document.body.textContent).toContain("7")
    expect(document.querySelector('[aria-label="搜索公开素材"]')).toBeNull()
    expect(tableColumnClasses()).toEqual(["w-auto", "w-20", "w-36", "w-16", "w-44", "w-44"])

    await clickButtonByLabel("复制 brand.png")

    expect(mocks.writeClipboardText).toHaveBeenCalledWith("https://synapse.test/files/asset_public")
    expect(mocks.toast).toHaveBeenCalledWith("链接已复制")
  })

  it("shows a toast when public asset link copying fails", async () => {
    mocks.writeClipboardText.mockRejectedValue(new Error("clipboard denied"))
    mocks.listDrivePublicAssets.mockResolvedValue(createPublicAssetPage([
      createPublicAsset({
        assetId: "asset_public",
        name: "brand.png",
        url: "https://synapse.test/files/asset_public",
      }),
    ]))

    await render(<DrivePublicAssetsView />)
    await flushAct()

    await clickButtonByLabel("复制 brand.png")

    expect(mocks.writeClipboardText).toHaveBeenCalledWith("https://synapse.test/files/asset_public")
    expect(mocks.toast).toHaveBeenCalledWith("clipboard denied")
  })

  it("loads more public assets from the next page", async () => {
    mocks.listDrivePublicAssets
      .mockResolvedValueOnce(createPublicAssetPage(
        [createPublicAsset({ assetId: "asset_first", name: "first.png" })],
        { hasMore: true, nextOffset: 50, total: 2 },
      ))
      .mockResolvedValueOnce(createPublicAssetPage(
        [createPublicAsset({ assetId: "asset_second", name: "second.png" })],
        { offset: 50, total: 2 },
      ))

    await render(<DrivePublicAssetsView />)
    await flushAct()

    expect(document.body.textContent).toContain("first.png")

    await clickButtonText("加载更多")

    expect(mocks.listDrivePublicAssets).toHaveBeenLastCalledWith({ offset: 50, limit: 50 })
    expect(document.body.textContent).toContain("first.png")
    expect(document.body.textContent).toContain("second.png")
  })

  it("marks missing public assets as unavailable", async () => {
    mocks.listDrivePublicAssets.mockResolvedValue(createPublicAssetPage([
      createPublicAsset({
        assetId: "asset_missing",
        name: "missing.png",
        lifecycleStatus: "legacy_missing",
      }),
    ]))

    await render(<DrivePublicAssetsView />)
    await flushAct()

    expect(document.body.textContent).toContain("missing.png")
    expect(document.body.textContent).toContain("不可用")
    expect(requireButtonByLabel("复制 missing.png").disabled).toBe(true)
  })

  it("disables copying links for trashed public assets", async () => {
    mocks.listDrivePublicAssets.mockResolvedValue(createPublicAssetPage([
      createPublicAsset({
        assetId: "asset_trashed",
        name: "trashed.png",
        lifecycleStatus: "trashed",
      }),
    ]))

    await render(<DrivePublicAssetsView />)
    await flushAct()

    expect(document.body.textContent).toContain("trashed.png")
    expect(document.body.textContent).toContain("回收站")
    expect(requireButtonByLabel("复制 trashed.png").disabled).toBe(true)
  })

  it("shows initial and load-more failures without dropping the current public asset list", async () => {
    mocks.listDrivePublicAssets
      .mockRejectedValueOnce(new Error("网络断开"))
      .mockResolvedValueOnce(createPublicAssetPage(
        [createPublicAsset({ assetId: "asset_first", name: "first.png" })],
        { hasMore: true, nextOffset: 50, total: 2 },
      ))
      .mockRejectedValueOnce(new Error("下一页失败"))

    await render(<DrivePublicAssetsView />)
    await flushAct()

    expect(document.body.textContent).toContain("读取失败")
    expect(document.body.textContent).not.toContain("first.png")

    await clickButtonText("重试")
    expect(mocks.listDrivePublicAssets).toHaveBeenLastCalledWith({ offset: 0, limit: 50 })
    expect(document.body.textContent).toContain("first.png")

    await clickButtonText("加载更多")
    expect(mocks.listDrivePublicAssets).toHaveBeenLastCalledWith({ offset: 50, limit: 50 })
    expect(document.body.textContent).toContain("first.png")
    expect(document.body.textContent).toContain("下一页失败")
  })

  it("uploads selected images and keeps ordered partial results visible", async () => {
    mocks.uploadDrivePublicAssets.mockResolvedValue({
      results: [
        { status: "fulfilled", fileName: "a.png", asset: createPublicAsset({ assetId: "asset_a", name: "a.png" }) },
        { status: "rejected", fileName: "b.jpg", message: "上传失败" },
        { status: "fulfilled", fileName: "c.webp", asset: createPublicAsset({ assetId: "asset_c", name: "c.webp" }) },
      ],
    })

    await render(<DrivePublicAssetsView />)
    await flushAct()

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error("Upload input not found")
    const first = new File(["a"], "a.png", { type: "image/png" })
    const second = new File(["b"], "b.jpg", { type: "image/jpeg" })
    const third = new File(["c"], "c.webp", { type: "image/webp" })
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [first, second, third],
    })

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }))
      await flushPromises()
    })

    expect(mocks.uploadDrivePublicAssets).toHaveBeenCalledWith({
      files: [
        { path: "/tmp/a.png", name: "a.png", mimeType: "image/png" },
        { path: "/tmp/b.jpg", name: "b.jpg", mimeType: "image/jpeg" },
        { path: "/tmp/c.webp", name: "c.webp", mimeType: "image/webp" },
      ],
    })
    expect(mocks.toast).toHaveBeenCalledWith("上传完成 2 个，失败 1 个")
    expect(uploadResultTexts()).toEqual(["a.png 已上传", "b.jpg 上传失败", "c.webp 已上传"])
  })

  it("notifies the parent after public asset operations that change usage", async () => {
    const onUsageChange = vi.fn()
    mocks.listDrivePublicAssets.mockResolvedValue(createPublicAssetPage([
      createPublicAsset({ assetId: "asset_active", itemId: "item-active", name: "active.png" }),
      createPublicAsset({ assetId: "asset_trashed", itemId: "item-trashed", name: "trashed.png", lifecycleStatus: "trashed" }),
    ]))
    mocks.uploadDrivePublicAssets.mockResolvedValue({
      results: [
        { status: "fulfilled", fileName: "new.png", asset: createPublicAsset({ assetId: "asset_new", name: "new.png" }) },
      ],
    })

    await render(<DrivePublicAssetsView onUsageChange={onUsageChange} />)
    await flushAct()

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error("Upload input not found")
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["new"], "new.png", { type: "image/png" })],
    })
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }))
      await flushPromises()
    })
    expect(onUsageChange).toHaveBeenCalledTimes(1)

    await openRowMenu("active.png")
    await clickText("替换文件")
    const replaceInput = document.querySelector<HTMLInputElement>('input[data-testid="drive-public-asset-replace-input"]')
    if (!replaceInput) throw new Error("Replace input not found")
    Object.defineProperty(replaceInput, "files", {
      configurable: true,
      value: [new File(["next"], "next.png", { type: "image/png" })],
    })
    await act(async () => {
      replaceInput.dispatchEvent(new Event("change", { bubbles: true }))
      await flushPromises()
    })
    expect(onUsageChange).toHaveBeenCalledTimes(2)

    await openRowMenu("trashed.png")
    await clickText("删除")
    await clickAlertDialogButtonText("删除")
    expect(onUsageChange).toHaveBeenCalledTimes(3)
  })

  it("does not upload files without local paths and clears stale upload results", async () => {
    mocks.uploadDrivePublicAssets.mockResolvedValueOnce({
      results: [
        { status: "fulfilled", fileName: "old.png", asset: createPublicAsset({ assetId: "asset_old", name: "old.png" }) },
      ],
    })

    await render(<DrivePublicAssetsView />)
    await flushAct()

    const input = requireUploadInput()
    const oldFile = new File(["old"], "old.png", { type: "image/png" })
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [oldFile],
    })
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }))
      await flushPromises()
    })
    expect(uploadResultTexts()).toEqual(["old.png 已上传"])

    mocks.filePathForDroppedFile.mockReturnValueOnce(null)
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["blocked"], "blocked.png", { type: "image/png" })],
    })
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }))
      await flushPromises()
    })

    expect(mocks.uploadDrivePublicAssets).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith("没有可上传的文件")
    expect(uploadResultTexts()).toEqual([])
  })

  it("uses the shared public asset image MIME list for file pickers", async () => {
    await render(<DrivePublicAssetsView />)
    await flushAct()

    const expectedAccept = Array.from(new Set(Object.values(DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION))).join(",")
    const inputs = [...document.querySelectorAll<HTMLInputElement>('input[type="file"]')]

    expect(inputs).toHaveLength(2)
    expect(inputs.map((input) => input.accept)).toEqual([expectedAccept, expectedAccept])
  })

  it("renames, replaces, trashes after confirmation, restores, and hides assets after confirmation", async () => {
    mocks.listDrivePublicAssets.mockResolvedValue(createPublicAssetPage([
      createPublicAsset({ assetId: "asset_active", itemId: "item-active", name: "active.png" }),
      createPublicAsset({ assetId: "asset_trashed", itemId: "item-trashed", name: "trashed.png", lifecycleStatus: "trashed" }),
    ]))

    await render(<DrivePublicAssetsView />)
    await flushAct()

    await openRowMenu("active.png")
    await clickText("重命名")
    setInputValue("#drive-public-asset-name", "brand.png")
    await clickButtonText("保存")
    expect(mocks.renameDrivePublicAsset).toHaveBeenCalledWith({ assetId: "asset_active", name: "brand.png" })

    await openRowMenu("active.png")
    await clickText("替换文件")
    const replaceInput = document.querySelector<HTMLInputElement>('input[data-testid="drive-public-asset-replace-input"]')
    if (!replaceInput) throw new Error("Replace input not found")
    const replacement = new File(["next"], "next.png", { type: "image/png" })
    Object.defineProperty(replaceInput, "files", {
      configurable: true,
      value: [replacement],
    })
    await act(async () => {
      replaceInput.dispatchEvent(new Event("change", { bubbles: true }))
      await flushPromises()
    })
    expect(mocks.replaceDrivePublicAssetFile).toHaveBeenCalledWith({
      assetId: "asset_active",
      path: "/tmp/next.png",
      name: "next.png",
      mimeType: "image/png",
    })

    await openRowMenu("active.png")
    await clickText("移到回收站")
    expect(mocks.trashDrivePublicAsset).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("确认移到回收站")
    await clickAlertDialogButtonText("移到回收站")
    expect(mocks.trashDrivePublicAsset).toHaveBeenCalledWith({ assetId: "asset_active" })

    await clickRowButtonText("trashed.png", "恢复")
    expect(mocks.restoreDrivePublicAsset).toHaveBeenCalledWith({ assetId: "asset_trashed" })

    await openRowMenu("trashed.png")
    await clickText("删除")
    expect(mocks.deleteDriveTrashItem).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("普通用户将不再看到")
    await clickAlertDialogButtonText("删除")
    expect(mocks.deleteDriveTrashItem).toHaveBeenCalledWith({ itemId: "item-trashed" })
  })

  it("cancels rename, trash, and delete actions without mutating assets", async () => {
    mocks.listDrivePublicAssets.mockResolvedValue(createPublicAssetPage([
      createPublicAsset({ assetId: "asset_active", itemId: "item-active", name: "active.png" }),
      createPublicAsset({ assetId: "asset_trashed", itemId: "item-trashed", name: "trashed.png", lifecycleStatus: "trashed" }),
    ]))

    await render(<DrivePublicAssetsView />)
    await flushAct()

    await openRowMenu("active.png")
    await clickText("重命名")
    expect(document.body.textContent).toContain("重命名")
    await clickButtonText("取消")
    expect(mocks.renameDrivePublicAsset).not.toHaveBeenCalled()
    expect(document.querySelector("#drive-public-asset-name")).toBeNull()

    await openRowMenu("active.png")
    await clickText("移到回收站")
    expect(document.body.textContent).toContain("确认移到回收站")
    await clickAlertDialogButtonText("取消")
    expect(mocks.trashDrivePublicAsset).not.toHaveBeenCalled()

    await openRowMenu("trashed.png")
    await clickText("删除")
    expect(document.body.textContent).toContain("确认删除")
    await clickAlertDialogButtonText("取消")
    expect(mocks.deleteDriveTrashItem).not.toHaveBeenCalled()
  })

  it("keeps blank rename submissions disabled until the name is valid", async () => {
    mocks.listDrivePublicAssets.mockResolvedValue(createPublicAssetPage([
      createPublicAsset({ assetId: "asset_active", name: "active.png" }),
    ]))

    await render(<DrivePublicAssetsView />)
    await flushAct()

    await openRowMenu("active.png")
    await clickText("重命名")
    const saveButton = requireButtonText("保存")
    expect(saveButton.disabled).toBe(false)

    setInputValue("#drive-public-asset-name", "   ")
    expect(requireButtonText("保存").disabled).toBe(true)

    setInputValue("#drive-public-asset-name", "brand.png")
    expect(requireButtonText("保存").disabled).toBe(false)
  })

  it("shows replacement failures without mutating the visible row", async () => {
    mocks.replaceDrivePublicAssetFile.mockRejectedValue(new Error("替换接口失败"))
    mocks.listDrivePublicAssets.mockResolvedValue(createPublicAssetPage([
      createPublicAsset({ assetId: "asset_active", name: "active.png" }),
    ]))

    await render(<DrivePublicAssetsView />)
    await flushAct()

    await openRowMenu("active.png")
    await clickText("替换文件")
    const replaceInput = requireReplaceInput()
    const replacement = new File(["next"], "next.png", { type: "image/png" })
    Object.defineProperty(replaceInput, "files", {
      configurable: true,
      value: [replacement],
    })
    await act(async () => {
      replaceInput.dispatchEvent(new Event("change", { bubbles: true }))
      await flushPromises()
    })

    expect(mocks.replaceDrivePublicAssetFile).toHaveBeenCalledWith({
      assetId: "asset_active",
      path: "/tmp/next.png",
      name: "next.png",
      mimeType: "image/png",
    })
    expect(mocks.toast).toHaveBeenCalledWith("替换接口失败")
    expect(document.body.textContent).toContain("active.png")
  })

  it("does not replace when selected replacement files have no local path", async () => {
    mocks.listDrivePublicAssets.mockResolvedValue(createPublicAssetPage([
      createPublicAsset({ assetId: "asset_active", name: "active.png" }),
    ]))

    await render(<DrivePublicAssetsView />)
    await flushAct()

    await openRowMenu("active.png")
    await clickText("替换文件")
    mocks.filePathForDroppedFile.mockReturnValueOnce(null)
    const replaceInput = requireReplaceInput()
    Object.defineProperty(replaceInput, "files", {
      configurable: true,
      value: [new File(["blocked"], "blocked.png", { type: "image/png" })],
    })
    await act(async () => {
      replaceInput.dispatchEvent(new Event("change", { bubbles: true }))
      await flushPromises()
    })

    expect(mocks.replaceDrivePublicAssetFile).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith("没有可替换的文件")
    expect(document.body.textContent).toContain("active.png")
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

function setInputValue(selector: string, value: string): void {
  const input = document.querySelector<HTMLInputElement>(selector)
  if (!input) throw new Error(`Input not found: ${selector}`)
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
  act(() => {
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

async function clickButtonText(text: string): Promise<void> {
  const button = requireButtonText(text)
  await act(async () => {
    button.click()
    await flushPromises()
  })
}

function requireButtonText(text: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}

async function clickAlertDialogButtonText(text: string): Promise<void> {
  const dialog = document.body.querySelector<HTMLElement>("[role='alertdialog']")
  if (!dialog) throw new Error("Alert dialog not found")
  const button = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!button) throw new Error(`Alert dialog button not found: ${text}`)
  await act(async () => {
    button.click()
    await flushPromises()
  })
}

async function clickRowButtonText(rowText: string, buttonText: string): Promise<void> {
  const button = Array.from(getTableRow(rowText).querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.trim() === buttonText)
  if (!button) throw new Error(`Button not found in row ${rowText}: ${buttonText}`)
  await act(async () => {
    button.click()
    await flushPromises()
  })
}

async function clickButtonByLabel(label: string): Promise<void> {
  const button = requireButtonByLabel(label)
  await act(async () => {
    button.click()
    await flushPromises()
  })
}

function requireButtonByLabel(label: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!button) throw new Error(`Button not found: ${label}`)
  return button
}

function tableColumnClasses(): string[] {
  return Array.from(document.body.querySelectorAll<HTMLTableColElement>("colgroup col"))
    .map((element) => element.className)
}

async function openRowMenu(name: string): Promise<void> {
  const trigger = document.querySelector<HTMLButtonElement>(`button[aria-label="更多 ${name}"]`)
  if (!trigger) throw new Error(`More menu button not found: ${name}`)
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
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

function getTableRow(text: string): HTMLTableRowElement {
  const row = Array.from(document.body.querySelectorAll<HTMLTableRowElement>("tbody tr"))
    .find((candidate) => candidate.textContent?.includes(text))
  if (!row) throw new Error(`Table row not found: ${text}`)
  return row
}

function uploadResultTexts(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-testid='drive-public-asset-upload-result']"))
    .map((element) => element.textContent?.trim() ?? "")
}

function requireUploadInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"][multiple]')
  if (!input) throw new Error("Upload input not found")
  return input
}

function requireReplaceInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[data-testid="drive-public-asset-replace-input"]')
  if (!input) throw new Error("Replace input not found")
  return input
}

function createPublicAsset(overrides: Partial<DrivePublicAssetDto> = {}): DrivePublicAssetDto {
  return {
    accessCount: "0",
    assetId: "asset_1",
    createdAt: "2026-06-07T00:00:00.000Z",
    itemId: "item-1",
    lastAccessedAt: null,
    lifecycleStatus: "active",
    mimeType: "image/png",
    name: "asset.png",
    responseBytes: "0",
    size: "1024",
    updatedAt: "2026-06-07T00:00:00.000Z",
    url: "https://synapse.test/files/asset_1",
    ...overrides,
  }
}

function createPublicAssetPage(
  items: readonly DrivePublicAssetDto[],
  page: Partial<DrivePublicAssetListPageDto["page"]> & { readonly total?: number } = {},
): DrivePublicAssetListPageDto {
  return {
    items,
    total: page.total ?? items.length,
    page: {
      offset: page.offset ?? 0,
      limit: page.limit ?? 50,
      hasMore: page.hasMore ?? false,
      nextOffset: page.nextOffset ?? null,
    },
  }
}
