import { BadRequestException, HttpStatus, UnauthorizedException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AllExceptionsFilter } from "./all-exceptions.filter"

function createMockHost(statusFn: ReturnType<typeof vi.fn>, jsonFn: ReturnType<typeof vi.fn>) {
  return {
    switchToHttp: () => ({
      getResponse: () => ({
        status: statusFn.mockReturnThis(),
        json: jsonFn,
      }),
    }),
  } as never
}

const mockLogger = { error: vi.fn() }

describe("AllExceptionsFilter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("maps HttpException to its status code", () => {
    const filter = new AllExceptionsFilter(mockLogger as never)
    const statusFn = vi.fn().mockReturnThis()
    const jsonFn = vi.fn()
    const host = createMockHost(statusFn, jsonFn)

    filter.catch(new BadRequestException("bad input"), host)

    expect(statusFn).toHaveBeenCalledWith(400)
    expect(jsonFn).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        error: HttpStatus[400],
      }),
    )
  })

  it("preserves stable HttpException codes from object responses", () => {
    const filter = new AllExceptionsFilter(mockLogger as never)
    const statusFn = vi.fn().mockReturnThis()
    const jsonFn = vi.fn()
    const host = createMockHost(statusFn, jsonFn)

    filter.catch(new UnauthorizedException({
      message: "未登录或登录已过期。",
      code: "refresh_invalid",
    }), host)

    expect(statusFn).toHaveBeenCalledWith(401)
    expect(jsonFn).toHaveBeenCalledWith({
      statusCode: 401,
      error: HttpStatus[401],
      message: "未登录或登录已过期。",
      code: "refresh_invalid",
    })
  })

  it("maps Prisma P2002 to 409 Conflict", () => {
    const filter = new AllExceptionsFilter(mockLogger as never)
    const statusFn = vi.fn().mockReturnThis()
    const jsonFn = vi.fn()
    const host = createMockHost(statusFn, jsonFn)

    const error = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002",
      clientVersion: "6.0.0",
    })
    filter.catch(error, host)

    expect(statusFn).toHaveBeenCalledWith(409)
  })

  it("maps Prisma P2025 to 404 Not Found", () => {
    const filter = new AllExceptionsFilter(mockLogger as never)
    const statusFn = vi.fn().mockReturnThis()
    const jsonFn = vi.fn()
    const host = createMockHost(statusFn, jsonFn)

    const error = new Prisma.PrismaClientKnownRequestError("not found", {
      code: "P2025",
      clientVersion: "6.0.0",
    })
    filter.catch(error, host)

    expect(statusFn).toHaveBeenCalledWith(404)
  })

  it("maps Prisma P2003 to 400 Bad Request", () => {
    const filter = new AllExceptionsFilter(mockLogger as never)
    const statusFn = vi.fn().mockReturnThis()
    const jsonFn = vi.fn()
    const host = createMockHost(statusFn, jsonFn)

    const error = new Prisma.PrismaClientKnownRequestError("foreign key", {
      code: "P2003",
      clientVersion: "6.0.0",
    })
    filter.catch(error, host)

    expect(statusFn).toHaveBeenCalledWith(400)
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({
      message: "请求引用的关联数据不存在。",
    }))
  })

  it("maps unknown errors to 500", () => {
    const filter = new AllExceptionsFilter(mockLogger as never)
    const statusFn = vi.fn().mockReturnThis()
    const jsonFn = vi.fn()
    const host = createMockHost(statusFn, jsonFn)

    filter.catch(new Error("unexpected"), host)

    expect(statusFn).toHaveBeenCalledWith(500)
  })

  it("maps exposed http-errors style payload too large errors to 413", () => {
    const filter = new AllExceptionsFilter(mockLogger as never)
    const statusFn = vi.fn().mockReturnThis()
    const jsonFn = vi.fn()
    const host = createMockHost(statusFn, jsonFn)

    filter.catch({
      status: 413,
      statusCode: 413,
      expose: true,
      type: "entity.too.large",
      message: "request entity too large",
    }, host)

    expect(statusFn).toHaveBeenCalledWith(413)
    expect(jsonFn).toHaveBeenCalledWith({
      statusCode: 413,
      error: HttpStatus[413],
      message: "request entity too large",
    })
  })

  it("does not expose arbitrary 500 object messages in production", () => {
    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = "production"
    const filter = new AllExceptionsFilter(mockLogger as never)
    const statusFn = vi.fn().mockReturnThis()
    const jsonFn = vi.fn()
    const host = createMockHost(statusFn, jsonFn)

    try {
      filter.catch({ statusCode: 500, message: "secret" }, host)
    } finally {
      process.env.NODE_ENV = previousNodeEnv
    }

    expect(statusFn).toHaveBeenCalledWith(500)
    expect(jsonFn).toHaveBeenCalledWith({
      statusCode: 500,
      error: "Internal Server Error",
      message: "服务器内部错误。",
    })
    expect(JSON.stringify(jsonFn.mock.calls)).not.toContain("secret")
  })

  it("exposes http-like 500 object messages outside production", () => {
    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = "development"
    const filter = new AllExceptionsFilter(mockLogger as never)
    const statusFn = vi.fn().mockReturnThis()
    const jsonFn = vi.fn()
    const host = createMockHost(statusFn, jsonFn)

    try {
      filter.catch({ statusCode: 500, message: "database is unavailable" }, host)
    } finally {
      process.env.NODE_ENV = previousNodeEnv
    }

    expect(statusFn).toHaveBeenCalledWith(500)
    expect(jsonFn).toHaveBeenCalledWith({
      statusCode: 500,
      error: "Internal Server Error",
      message: "database is unavailable",
    })
  })

  it("redacts 500 exception logs without passing the raw exception object", () => {
    const filter = new AllExceptionsFilter(mockLogger as never)
    const statusFn = vi.fn().mockReturnThis()
    const jsonFn = vi.fn()
    const host = createMockHost(statusFn, jsonFn)
    const error = new Error("Authorization: Bearer secret-bearer token=plain-token https://user:password@example.com/private /Users/liyang/private")

    filter.catch(error, host)

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        errorName: "Error",
        error: expect.stringContaining("[REDACTED]"),
        stackLength: expect.any(Number),
      }),
      "Unhandled server exception",
    )
    expect(mockLogger.error).not.toHaveBeenCalledWith(expect.objectContaining({ err: error }), expect.anything())
    const raw = JSON.stringify(mockLogger.error.mock.calls)
    expect(raw).not.toContain("secret-bearer")
    expect(raw).not.toContain("plain-token")
    expect(raw).not.toContain("user:password")
    expect(raw).not.toContain("/Users/liyang/private")
  })
})
