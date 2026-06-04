import { describe, expect, it } from "vitest"

import { httpRequestActionConfigSchema } from "../schema"

describe("builtin.http-request schema", () => {
  it("rejects GET requests with a body", () => {
    const result = httpRequestActionConfigSchema.safeParse({
      method: "GET",
      url: "https://example.com/api",
      bodyType: "json",
      body: "{\"ok\":true}",
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toEqual([
        expect.objectContaining({
          path: ["bodyType"],
          message: "GET 请求不支持 Body",
        }),
      ])
    }
  })

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
