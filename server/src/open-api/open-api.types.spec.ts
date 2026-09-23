import { describe, expect, it } from "vitest"
import { ThrottlerException } from "@nestjs/throttler"
import { openApiRequestId, toOpenApiError } from "./open-api.types"

describe("openApiRequestId", () => {
  it("uses one process-independent id for the full request lifecycle", () => {
    const request = { id: 1 } as never

    const first = openApiRequestId(request)

    expect(first).toMatch(/^req_[a-f0-9]{32}$/u)
    expect(openApiRequestId(request)).toBe(first)
    expect(first).not.toBe("1")
  })
})

describe("toOpenApiError", () => {
  it("keeps request throttling as HTTP 429", () => {
    expect(toOpenApiError(new ThrottlerException())).toMatchObject({ statusCode: 429, code: "RATE_LIMITED" })
  })
})
