import { describe, expect, it, vi } from "vitest"
import { OpenApiExceptionFilter } from "./open-api-exception.filter"
import { OpenApiHttpError } from "./open-api.types"

describe("OpenApiExceptionFilter", () => {
  it("returns the stable envelope without logging sensitive exception text", () => {
    const logger = { error: vi.fn() }
    const response = {
      headersSent: false,
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      destroy: vi.fn(),
    }
    const request = { openApiRequestId: "req-1" }
    const host = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    }
    const filter = new OpenApiExceptionFilter(logger as never)
    const canary = "storage/private-user/file-secret"

    filter.catch(new Error(`Object unavailable: ${canary}`), host as never)

    expect(response.status).toHaveBeenCalledWith(500)
    expect(response.json).toHaveBeenCalledWith({
      requestId: "req-1",
      error: { code: "INTERNAL_ERROR", message: "服务器内部错误。" },
    })
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(canary)
    expect(logger.error).toHaveBeenCalledWith({
      requestId: "req-1",
      errorCode: "INTERNAL_ERROR",
      errorName: "Error",
    }, "Open API request failed")
  })

  it("sets Retry-After for a database timeout", () => {
    const response = {
      headersSent: false,
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      destroy: vi.fn(),
    }
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ openApiRequestId: "req-db" }),
        getResponse: () => response,
      }),
    }
    new OpenApiExceptionFilter({ error: vi.fn() } as never).catch(
      new OpenApiHttpError(503, "DB_STATEMENT_TIMEOUT", "数据库查询超时，请稍后重试。"),
      host as never,
    )
    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", "5")
    expect(response.status).toHaveBeenCalledWith(503)
  })
})
