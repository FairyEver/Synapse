/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CONTENT_ICON_IMAGE_PENDING_VALUE, useContentIconImage } from "../use-content-icon-image"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const logger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => logger,
}))

let roots: Root[] = []
let latestHook: ReturnType<typeof useContentIconImage> | null = null

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  latestHook = null
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

describe("useContentIconImage", () => {
  it("revokes the selected blob URL when the component unmounts while open", async () => {
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:icon")
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<Probe />)
    })

    await act(async () => {
      latestHook?.handleIconImageChange({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
        size: 4,
      } as Blob)
      await Promise.resolve()
    })
    expect(createObjectUrl).toHaveBeenCalledTimes(1)

    act(() => {
      root.unmount()
    })

    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:icon")
  })

  it("marks the form dirty when replacing an existing image icon", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:updated-icon")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
    const updateField = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <Probe
          contentId="rule-1"
          iconImage="icon.png"
          updateField={updateField}
        />,
      )
    })

    await act(async () => {
      latestHook?.handleIconImageChange({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
        size: 4,
      } as Blob)
      await Promise.resolve()
    })

    expect(updateField).toHaveBeenCalledWith("iconType", "image")
    expect(updateField).toHaveBeenCalledWith("iconImage", CONTENT_ICON_IMAGE_PENDING_VALUE)

    const prepared = latestHook?.prepareFormForSubmit<Record<string, unknown>>({
      iconImage: CONTENT_ICON_IMAGE_PENDING_VALUE,
      iconType: "image",
      title: "Existing rule",
    })

    expect(prepared).toMatchObject({
      iconImage: "icon.png",
      iconType: "image",
      title: "Existing rule",
    })
    expect(prepared?.iconImageBytes).toBeInstanceOf(Uint8Array)
  })
})

function Probe({
  contentId = null,
  iconImage = "",
  updateField,
}: {
  contentId?: string | null
  iconImage?: string
  updateField?: Parameters<typeof useContentIconImage>[0]["updateField"]
}) {
  latestHook = useContentIconImage({
    contentId,
    contentType: "rule",
    iconImage,
    iconType: "image",
    open: true,
    updateField,
  })
  return null
}
