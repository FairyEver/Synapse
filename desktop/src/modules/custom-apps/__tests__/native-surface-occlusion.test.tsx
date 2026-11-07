/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

const setOccluded = vi.hoisted(() => vi.fn())

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => ({
    customApps: {
      view: { setOccluded },
    },
  }),
}))

import {
  NativeSurfaceOcclusionProvider,
  useNativeSurfaceOcclusion,
} from "../native-surface-occlusion"
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu"
import { DropdownMenu, DropdownMenuContent } from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: ReturnType<typeof createRoot> | null = null
let container: HTMLDivElement | null = null

describe("NativeSurfaceOcclusionProvider", () => {
  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
    vi.clearAllMocks()
  })

  it("hides while an overlay is open and restores after it unmounts", async () => {
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)

    function Overlay() {
      useNativeSurfaceOcclusion()
      return null
    }
    function Harness({ open }: { readonly open: boolean }) {
      return (
        <NativeSurfaceOcclusionProvider>
          {open ? <Overlay /> : null}
        </NativeSurfaceOcclusionProvider>
      )
    }

    await act(async () => root!.render(<Harness open />))
    expect(setOccluded).toHaveBeenCalledWith(true)
    await act(async () => root!.render(<Harness open={false} />))
    expect(setOccluded).toHaveBeenLastCalledWith(false)
  })

  it("keeps a closed context menu from acquiring an occlusion lease", async () => {
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root!.render(
      <NativeSurfaceOcclusionProvider>
        <ContextMenu>
          <ContextMenuTrigger>打开菜单</ContextMenuTrigger>
        </ContextMenu>
      </NativeSurfaceOcclusionProvider>,
    ))

    expect(setOccluded).not.toHaveBeenCalled()
  })

  it("keeps force-mounted closed dropdown content from acquiring a lease", async () => {
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root!.render(
      <NativeSurfaceOcclusionProvider>
        <DropdownMenu>
          <DropdownMenuContent forceMount>菜单</DropdownMenuContent>
        </DropdownMenu>
      </NativeSurfaceOcclusionProvider>,
    ))

    expect(setOccluded).not.toHaveBeenCalled()
  })

  it("only acquires while a dialog is actually mounted", async () => {
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)

    function Harness({ open }: { readonly open: boolean }) {
      return (
        <NativeSurfaceOcclusionProvider>
          <Dialog open={open}>
            <DialogContent>
              <DialogTitle>验收</DialogTitle>
            </DialogContent>
          </Dialog>
        </NativeSurfaceOcclusionProvider>
      )
    }

    await act(async () => root!.render(<Harness open={false} />))
    expect(setOccluded).not.toHaveBeenCalled()
    await act(async () => root!.render(<Harness open />))
    expect(setOccluded).toHaveBeenCalledWith(true)
    await act(async () => root!.render(<Harness open={false} />))
    expect(setOccluded).toHaveBeenLastCalledWith(false)
  })
})
