import { describe, expect, it } from "vitest"

import { httpRequestActionConfigSchema } from "../schema"

describe("builtin.http-request schema", () => {
  it("requires credentials when an auth type is selected", () => {
    expect(httpRequestActionConfigSchema.safeParse({
      method: "GET",
      url: "https://example.com/api",
      bodyType: "none",
      auth: { type: "bearer", bearerToken: "" },
    }).success).toBe(false)

    expect(httpRequestActionConfigSchema.safeParse({
      method: "GET",
      url: "https://example.com/api",
      bodyType: "none",
      auth: { type: "basic", basicUsername: " " },
    }).success).toBe(false)
  })
})
