import express from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"

import { createHttpSecurityMiddleware } from "./http-security"

describe("HTTP security headers", () => {
  it("allows Synapse web responses to be framed by any origin", async () => {
    const app = express()
    app.use(createHttpSecurityMiddleware(true))
    app.get("/", (_request, response) => {
      response.type("html").send("<h1>Synapse</h1>")
    })

    const response = await request(app).get("/").expect(200)

    expect(response.headers["content-security-policy"]).toContain("default-src 'self'")
    expect(response.headers["content-security-policy"]).not.toContain("frame-ancestors")
    expect(response.headers["x-frame-options"]).toBeUndefined()
  })
})
