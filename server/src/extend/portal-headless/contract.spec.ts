import { describe, expect, it, vi } from "vitest"
import { catalogInput, parseInput, portalHeaders } from "./contract"
import { AllExceptionsFilter } from "../../common/all-exceptions.filter"

function httpError(run: () => unknown) {
  let error: unknown
  try { run() } catch (caught) { error = caught }
  expect(error).toBeDefined()
  const json = vi.fn(); const status = vi.fn().mockReturnThis()
  new AllExceptionsFilter({ error: vi.fn() } as never).catch(error, {
    switchToHttp: () => ({ getResponse: () => ({ status, json }), getRequest: () => ({ url: "/api/extend/portal-headless/catalog" }) }),
  } as never)
  expect(status).toHaveBeenCalledWith(400)
  return json.mock.calls[0][0]
}
describe("Portal safe field validation", () => {
  it("returns a missing domain through the actual HTTP exception filter", () => {
    expect(httpError(() => parseInput(catalogInput, { op: "pages" }))).toMatchObject({
      code: "INVALID_REQUEST", fields: [{ path: "domain", code: "required", message: "缺少必填参数" }],
    })
  })
  it("rejects invalid cursors with field context", () => {
    expect(httpError(() => parseInput(catalogInput, { op: "pages", domain: "year-agreement", offset: "None" })))
      .toMatchObject({ fields: [{ path: "offset", code: "invalid_type" }] })
  })
  it("does not reflect unknown keys, input values or credentials", () => {
    const errors = [
      httpError(() => parseInput(catalogInput, { op: "pages", domain: "", "secret-canary": "value-canary" })),
      httpError(() => parseInput(portalHeaders, { token: "token-canary\n", tenantId: "tenant", language: "language-canary" })),
    ]
    expect(JSON.stringify(errors)).not.toMatch(/secret-canary|value-canary|token-canary|language-canary/)
  })
})
