import express from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import {
  parseProblemFeedbackJson,
  problemFeedbackRawJsonParser,
} from "./problem-feedback-http"

function createParserApp() {
  const app = express()
  app.use(problemFeedbackRawJsonParser)
  app.post("/api/problem-feedback", (httpRequest, response) => {
    response.json(httpRequest.body)
  })
  return app
}

describe("problem feedback raw JSON parser", () => {
  it("passes one strict JSON value through unchanged", async () => {
    await request(createParserApp())
      .post("/api/problem-feedback")
      .set("Content-Type", "application/json; charset=utf-8")
      .send('{"content":"场景：合成测试。\\n实际情况：失败。"}')
      .expect(200, {
        content: "场景：合成测试。\n实际情况：失败。",
      })
  })

  it.each([
    ["duplicate keys", '{"content":"first","content":"second"}'],
    ["trailing value", '{"content":"first"}{"content":"second"}'],
    ["comments", '{"content":"first"/* comment */}'],
    ["BOM", `\ufeff{"content":"first"}`],
  ])("rejects %s without echoing the body", async (_name, body) => {
    const response = await request(createParserApp())
      .post("/api/problem-feedback")
      .set("Content-Type", "application/json")
      .send(body)
      .expect(400)

    expect(response.body).toEqual({
      code: "INVALID_INPUT",
      data: { field: "request", reason: "type" },
    })
    expect(response.text).not.toContain("first")
    expect(response.headers["cache-control"]).toBe("no-store")
  })

  it("rejects fatal UTF-8 decoding failures", () => {
    expect(parseProblemFeedbackJson(Uint8Array.from([0xc3, 0x28]))).toEqual({ ok: false })
  })

  it("rejects unsupported media and content encodings", async () => {
    await request(createParserApp())
      .post("/api/problem-feedback")
      .set("Content-Type", "text/plain")
      .send("{}")
      .expect(400, {
        code: "INVALID_INPUT",
        data: { field: "request", reason: "type" },
      })

    await request(createParserApp())
      .post("/api/problem-feedback")
      .set("Content-Type", "application/json")
      .set("Content-Encoding", "gzip")
      .send("{}")
      .expect(400, {
        code: "INVALID_INPUT",
        data: { field: "request", reason: "type" },
      })
  })

  it("rejects more than one MiB before application validation", async () => {
    await request(createParserApp())
      .post("/api/problem-feedback")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ content: "a".repeat(1024 * 1024) }))
      .expect(400, {
        code: "INVALID_INPUT",
        data: { field: "request", reason: "too_large" },
      })
  })
})
