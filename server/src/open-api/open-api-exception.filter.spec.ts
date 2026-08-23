import { describe, expect, it, vi } from "vitest"
import { OpenApiExceptionFilter } from "./open-api-exception.filter"

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
})
