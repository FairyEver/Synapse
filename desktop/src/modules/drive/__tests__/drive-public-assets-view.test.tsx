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

    await clickButtonByLabel("复制 brand.png")

    expect(mocks.writeClipboardText).toHaveBeenCalledWith("https://synapse.test/files/asset_public")
    expect(mocks.toast).toHaveBeenCalledWith("链接已复制")
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

    await clickRowButtonText("active.png", "替换文件")
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

    await clickRowButtonText("active.png", "移到回收站")
    expect(mocks.trashDrivePublicAsset).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("确认移到回收站")
    await clickAlertDialogButtonText("移到回收站")
    expect(mocks.trashDrivePublicAsset).toHaveBeenCalledWith({ assetId: "asset_active" })

    await clickRowButtonText("trashed.png", "恢复")
    expect(mocks.restoreDrivePublicAsset).toHaveBeenCalledWith({ assetId: "asset_trashed" })

    await clickRowButtonText("trashed.png", "删除")
    expect(mocks.deleteDriveTrashItem).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("普通用户将不再看到")
    await clickAlertDialogButtonText("删除")
    expect(mocks.deleteDriveTrashItem).toHaveBeenCalledWith({ itemId: "item-trashed" })
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

async function clickButtonText(text: string): Promise<void> {
  const button = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  await act(async () => {
    button.click()
    await flushPromises()
  })
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

function setInputValue(selector: string, value: string): void {
  const input = document.querySelector<HTMLInputElement>(selector)
  if (!input) throw new Error(`Input not found: ${selector}`)
  act(() => {
    input.value = value
    input.dispatchEvent(new Event("input", { bubbles: true }))
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
