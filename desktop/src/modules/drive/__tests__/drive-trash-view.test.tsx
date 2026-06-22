/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DriveTrashItemDto, DriveTrashListPageDto } from "@synapse/shared"

import { DriveTrashView } from "../drive-trash-view"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  deleteDriveTrashItem: vi.fn(),
  listDriveTrash: vi.fn(),
  restoreDriveTrashItem: vi.fn(),
  toast: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: mocks.toast,
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => ({
    account: {
      deleteDriveTrashItem: mocks.deleteDriveTrashItem,
      listDriveTrash: mocks.listDriveTrash,
      restoreDriveTrashItem: mocks.restoreDriveTrashItem,
    },
  }),
}))

let roots: Root[] = []

beforeEach(() => {
  mocks.deleteDriveTrashItem.mockResolvedValue({ ok: true })
  mocks.listDriveTrash.mockResolvedValue(createTrashPage([]))
  mocks.restoreDriveTrashItem.mockResolvedValue({ ok: true })
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

describe("DriveTrashView", () => {
  it("lists normal drive items and public assets", async () => {
    mocks.listDriveTrash.mockResolvedValue(createTrashPage([
      createTrashItem({
        id: "folder-1",
        kind: "normal",
        name: "旧资料",
        type: "folder",
        originalPath: "项目/旧资料",
      }),
      createTrashItem({
        id: "asset-item-1",
        assetId: "asset_public",
        kind: "public_asset",
        name: "logo.png",
        type: "file",
        mimeType: "image/png",
      }),
    ]))

    await render(<DriveTrashView />)
    await flushAct()

    expect(mocks.listDriveTrash).toHaveBeenCalledWith({ offset: 0, limit: 50 })
    expect(document.body.textContent).toContain("回收站")
    expect(document.body.textContent).toContain("旧资料")
    expect(document.body.textContent).toContain("普通文件")
    expect(document.body.textContent).toContain("项目/旧资料")
    expect(document.body.textContent).toContain("logo.png")
    expect(document.body.textContent).toContain("公开素材")
    expect(document.querySelector('[aria-label="搜索回收站"]')).toBeNull()
    expect(tableColumnClasses()).toEqual(["w-auto", "w-28", "w-20", "w-56", "w-44", "w-36"])
  })

  it("loads more trash entries from the next page", async () => {
    mocks.listDriveTrash
      .mockResolvedValueOnce(createTrashPage(
        [createTrashItem({ id: "file-1", name: "first.txt" })],
        { hasMore: true, nextOffset: 50, total: 2 },
      ))
      .mockResolvedValueOnce(createTrashPage(
        [createTrashItem({ id: "file-2", name: "second.txt" })],
        { offset: 50, total: 2 },
      ))

    await render(<DriveTrashView />)
    await flushAct()

    expect(document.body.textContent).toContain("first.txt")

    await clickButtonText("加载更多")

    expect(mocks.listDriveTrash).toHaveBeenLastCalledWith({ offset: 50, limit: 50 })
    expect(document.body.textContent).toContain("first.txt")
    expect(document.body.textContent).toContain("second.txt")
  })

  it("shows initial and load-more failures without dropping current trash entries", async () => {
    mocks.listDriveTrash
      .mockRejectedValueOnce(new Error("回收站网络错误"))
      .mockResolvedValueOnce(createTrashPage(
        [createTrashItem({ id: "file-1", name: "first.txt" })],
        { hasMore: true, nextOffset: 50, total: 2 },
      ))
      .mockRejectedValueOnce(new Error("下一页失败"))

    await render(<DriveTrashView />)
    await flushAct()

    expect(document.body.textContent).toContain("读取失败")
    expect(document.body.textContent).not.toContain("first.txt")

    await clickButtonText("重试")
    expect(mocks.listDriveTrash).toHaveBeenLastCalledWith({ offset: 0, limit: 50 })
    expect(document.body.textContent).toContain("first.txt")

    await clickButtonText("加载更多")
    expect(mocks.listDriveTrash).toHaveBeenLastCalledWith({ offset: 50, limit: 50 })
    expect(document.body.textContent).toContain("first.txt")
    expect(document.body.textContent).toContain("下一页失败")
  })

  it("restores and deletes trash entries after confirmation", async () => {
    const onDriveItemsChanged = vi.fn()
    const onUsageChange = vi.fn()
    mocks.listDriveTrash.mockResolvedValue(createTrashPage([
      createTrashItem({ id: "file-1", kind: "normal", name: "normal.txt" }),
      createTrashItem({ id: "asset-item-1", assetId: "asset_public", kind: "public_asset", name: "public.png" }),
    ]))

    await render(<DriveTrashView onDriveItemsChanged={onDriveItemsChanged} onUsageChange={onUsageChange} />)
    await flushAct()

    await clickRowButtonText("normal.txt", "恢复")
    expect(mocks.restoreDriveTrashItem).toHaveBeenCalledWith({ itemId: "file-1", kind: "normal" })
    expect(mocks.toast).toHaveBeenCalledWith("已恢复")
    expect(onDriveItemsChanged).toHaveBeenCalledTimes(1)
    expect(onUsageChange).not.toHaveBeenCalled()

    await clickRowButtonText("public.png", "恢复")
    expect(mocks.restoreDriveTrashItem).toHaveBeenCalledWith({
      assetId: "asset_public",
      itemId: "asset-item-1",
      kind: "public_asset",
    })
    expect(onDriveItemsChanged).toHaveBeenCalledTimes(2)

    await clickRowButtonText("public.png", "删除")
    expect(mocks.deleteDriveTrashItem).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("普通用户将不再看到")
    await clickAlertDialogButtonText("删除")
    expect(mocks.deleteDriveTrashItem).toHaveBeenCalledWith({ itemId: "asset-item-1" })
    expect(mocks.toast).toHaveBeenCalledWith("已删除")
    expect(onUsageChange).toHaveBeenCalledTimes(1)
  })

  it("cancels deletion and keeps entries visible when restore or delete fails", async () => {
    mocks.listDriveTrash.mockResolvedValue(createTrashPage([
      createTrashItem({ id: "file-1", kind: "normal", name: "normal.txt" }),
      createTrashItem({ id: "asset-item-1", assetId: "asset_public", kind: "public_asset", name: "public.png" }),
    ]))
    mocks.restoreDriveTrashItem.mockRejectedValue(new Error("恢复接口失败"))
    mocks.deleteDriveTrashItem.mockRejectedValue(new Error("删除接口失败"))

    await render(<DriveTrashView />)
    await flushAct()

    await clickRowButtonText("public.png", "删除")
    expect(document.body.textContent).toContain("确认删除")
    await clickAlertDialogButtonText("取消")
    expect(mocks.deleteDriveTrashItem).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("public.png")

    await clickRowButtonText("normal.txt", "恢复")
    expect(mocks.restoreDriveTrashItem).toHaveBeenCalledWith({ itemId: "file-1", kind: "normal" })
    expect(mocks.toast).toHaveBeenCalledWith("恢复接口失败")
    expect(document.body.textContent).toContain("normal.txt")

    await clickRowButtonText("public.png", "删除")
    await clickAlertDialogButtonText("删除")
    expect(mocks.deleteDriveTrashItem).toHaveBeenCalledWith({ itemId: "asset-item-1" })
    expect(mocks.toast).toHaveBeenCalledWith("删除接口失败")
    expect(document.body.textContent).toContain("public.png")
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

function getTableRow(text: string): HTMLTableRowElement {
  const row = Array.from(document.body.querySelectorAll<HTMLTableRowElement>("tbody tr"))
    .find((candidate) => candidate.textContent?.includes(text))
  if (!row) throw new Error(`Table row not found: ${text}`)
  return row
}

function tableColumnClasses(): string[] {
  return Array.from(document.body.querySelectorAll<HTMLTableColElement>("colgroup col"))
    .map((element) => element.className)
}

function createTrashItem(overrides: Partial<DriveTrashItemDto> = {}): DriveTrashItemDto {
  return {
    id: "item-1",
    kind: "normal",
    mimeType: "text/plain",
    name: "deleted.txt",
    originalPath: "deleted.txt",
    size: "1024",
    trashedAt: "2026-06-07T00:00:00.000Z",
    type: "file",
    ...overrides,
  }
}

function createTrashPage(
  items: readonly DriveTrashItemDto[],
  page: Partial<DriveTrashListPageDto["page"]> & { readonly total?: number } = {},
): DriveTrashListPageDto {
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
