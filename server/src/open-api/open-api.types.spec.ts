import { describe, expect, it } from "vitest"
import { openApiRequestId } from "./open-api.types"

describe("openApiRequestId", () => {
  it("uses one process-independent id for the full request lifecycle", () => {
    const request = { id: 1 } as never

    const first = openApiRequestId(request)

    expect(first).toMatch(/^req_[a-f0-9]{32}$/u)
    expect(openApiRequestId(request)).toBe(first)
    expect(first).not.toBe("1")
  })
})
