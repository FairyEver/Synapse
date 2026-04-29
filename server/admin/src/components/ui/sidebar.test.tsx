import * as React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { render } from "@/test/render"
import { SidebarProvider } from "@/components/ui/sidebar"

describe("SidebarProvider", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
  })

  it("sets the desktop sidebar width to an integer rem value", async () => {
    const result = await render(
      <SidebarProvider>
        <div />
      </SidebarProvider>
    )

    const wrapper = result.container.querySelector<HTMLElement>('[data-slot="sidebar-wrapper"]')

    expect(wrapper?.style.getPropertyValue("--sidebar-width")).toBe("13rem")

    result.unmount()
  })
})
