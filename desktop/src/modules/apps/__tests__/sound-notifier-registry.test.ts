import { describe, expect, it } from "vitest"
import { parseSystemAppId } from "../definitions"
import { getSystemAppManifest } from "../registry"

describe("Sound Notifier app registry", () => {
  it("does not register Sound Notifier as a system app", () => {
    expect(getSystemAppManifest("sound-notifier")).toBeNull()
    expect(parseSystemAppId("sound-notifier")).toBeNull()
  })
})
