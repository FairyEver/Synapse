import { describe, expect, it, vi } from "vitest"

import { holdBeforeUnloadForCustomDialog } from "../before-unload"

describe("holdBeforeUnloadForCustomDialog", () => {
  it("uses Electron's silent cancel value without triggering native prompt text", () => {
    const event = {
      preventDefault: vi.fn(),
      returnValue: true,
    } as unknown as BeforeUnloadEvent & { returnValue: unknown }

    holdBeforeUnloadForCustomDialog(event)

    expect(event.returnValue).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
