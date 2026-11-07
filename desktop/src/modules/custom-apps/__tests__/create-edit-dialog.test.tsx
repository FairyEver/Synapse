/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { CustomAppCreateInput, CustomAppUpdateInput } from "@synapse/shared"

import { CreateEditCustomAppDialog } from "../create-edit-dialog"

let root: ReturnType<typeof createRoot> | null = null
let container: HTMLDivElement | null = null
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("CreateEditCustomAppDialog", () => {
  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
    document.body.innerHTML = ""
  })

  it("creates a custom app with a local icon override", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const chooseIcon = vi.fn().mockResolvedValue({
      pngBase64: "iVBOR...",
      dataUrl: "data:image/png;base64,iVBOR...",
    })
    await renderDialog({ onSubmit, chooseIcon })

    await setInput("名称", "阅读")
    await setInput("网址", "https://example.com/read")
    await act(async () => button("选择图片").click())
    await act(async () => button("创建").click())

    expect(chooseIcon).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      operationId: expect.any(String),
      id: expect.stringMatching(/^cwa_/u),
      name: "阅读",
      startUrl: "https://example.com/read",
      iconSource: "custom",
      iconPngBase64: "iVBOR...",
    }))
  })

  it("retries favicon discovery when the URL changes and no custom icon is selected", async () => {
    const fetchFavicon = vi.fn().mockResolvedValue({
      pngBase64: "AAAA",
      dataUrl: "data:image/png;base64,AAAA",
    })
    await renderDialog({ fetchFavicon })

    const url = input("网址")
    await act(async () => {
      setNativeInputValue(url, "https://example.com/read")
      url.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))
    })
    await act(async () => Promise.resolve())

    expect(fetchFavicon).toHaveBeenCalledWith("https://example.com/read")
  })

  it("submits only changed fields when editing", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    await renderDialog({
      mode: "edit",
      app: customApp(),
      onSubmit,
    })

    await setInput("名称", "阅读清单")
    await act(async () => button("保存").click())

    expect(onSubmit).toHaveBeenCalledWith({
      operationId: expect.any(String),
      name: "阅读清单",
    })
  })

  it("reuses the create attempt after a failed response", async () => {
    const onSubmit = vi.fn()
      .mockRejectedValueOnce(new Error("network lost"))
      .mockResolvedValueOnce(undefined)
    await renderDialog({ onSubmit })
    await setInput("名称", "阅读")
    await setInput("网址", "https://example.com/read")

    await act(async () => button("创建").click())
    await act(async () => button("创建").click())

    expect(onSubmit).toHaveBeenCalledTimes(2)
    expect(onSubmit.mock.calls[1][0]).toMatchObject({
      operationId: onSubmit.mock.calls[0][0].operationId,
      id: onSubmit.mock.calls[0][0].id,
    })
  })

  it("fetches the website icon when switching away from a custom icon", async () => {
    const fetchFavicon = vi.fn().mockResolvedValue({
      pngBase64: "AAAA",
      dataUrl: "data:image/png;base64,AAAA",
    })
    await renderDialog({
      mode: "edit",
      app: customApp({ iconSource: "custom", iconUrl: "https://example.com/icon.png" }),
      fetchFavicon,
    })

    await act(async () => button("使用网站图标").click())
    await act(async () => Promise.resolve())

    expect(fetchFavicon).toHaveBeenCalledWith("https://example.com/read")
  })
})

async function renderDialog(overrides: Partial<{
  onSubmit: (input: CustomAppCreateInput | CustomAppUpdateInput) => Promise<void>
  fetchFavicon: (url: string) => Promise<{ pngBase64: string; dataUrl: string } | null>
  chooseIcon: () => Promise<{ pngBase64: string; dataUrl: string } | null>
  mode: "create" | "edit"
  app: import("@synapse/shared").CustomAppDto
}> = {}) {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(
    <CreateEditCustomAppDialog
      open
      mode={overrides.mode ?? "create"}
      app={overrides.app}
      disabled={false}
      onClose={vi.fn()}
      onSubmit={overrides.onSubmit ?? vi.fn()}
      fetchFavicon={overrides.fetchFavicon ?? vi.fn().mockResolvedValue(null)}
      chooseIcon={overrides.chooseIcon ?? vi.fn().mockResolvedValue(null)}
    />,
  ))
}

function customApp(overrides: Partial<import("@synapse/shared").CustomAppDto> = {}) {
  return {
    id: "cwa_123e4567-e89b-42d3-a456-426614174000" as const,
    kind: "web",
    schemaVersion: 1 as const,
    name: "阅读",
    startUrl: "https://example.com/read",
    iconUrl: null,
    iconSource: "favicon" as const,
    version: 1,
    createdAt: "2026-11-07T00:00:00.000Z",
    updatedAt: "2026-11-07T00:00:00.000Z",
    ...overrides,
  }
}

async function setInput(label: string, value: string) {
  const target = input(label)
  await act(async () => setNativeInputValue(target, value))
}

function input(label: string): HTMLInputElement {
  const element = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  if (!element) throw new Error(`Missing input ${label}`)
  return element
}

function button(label: string): HTMLButtonElement {
  const element = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label)
  if (!element) throw new Error(`Missing button ${label}`)
  return element
}

function setNativeInputValue(target: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  setter?.call(target, value)
  target.dispatchEvent(new Event("input", { bubbles: true }))
  target.dispatchEvent(new Event("change", { bubbles: true }))
}
