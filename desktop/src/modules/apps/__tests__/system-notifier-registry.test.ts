import { describe, expect, it } from "vitest"
import { parseSystemAppId } from "../definitions"
import { getSystemAppManifest } from "../registry"

describe("System Notifier app registry", () => {
  it("does not register System Notifier as a system app", () => {
    expect(getSystemAppManifest("system-notifier")).toBeNull()
    expect(parseSystemAppId("system-notifier")).toBeNull()
  })
})
