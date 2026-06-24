import { describe, expect, it } from "vitest"
import { assertCanonicalCapabilityId } from "./naming"

describe("App capability domain", () => {
  it("allows terminal session write and stop capability ids", () => {
    expect(() => assertCanonicalCapabilityId("app.terminal.session.write")).not.toThrow()
    expect(() => assertCanonicalCapabilityId("app.terminal.session.stop")).not.toThrow()
  })
})
