import { describe, expect, it, vi } from "vitest"

import { detectInstallPlaceholders } from "@/modules/content/components/content-install-dialog"

describe("detectInstallPlaceholders", () => {
  it("reads current content when preload is unavailable before placeholder detection", async () => {
    const readCurrentContent = vi.fn().mockResolvedValue("Hello ${{ token }}")

    await expect(detectInstallPlaceholders(null, readCurrentContent)).resolves.toEqual(["token"])
    expect(readCurrentContent).toHaveBeenCalledTimes(1)
  })
})
