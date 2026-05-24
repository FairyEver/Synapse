import { BadRequestException, HttpStatus } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
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

const mockLogger = { error: vi.fn() } as never

describe("AllExceptionsFilter", () => {
  it("maps HttpException to its status code", () => {
    const filter = new AllExceptionsFilter(mockLogger)
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

  it("maps Prisma P2002 to 409 Conflict", () => {
    const filter = new AllExceptionsFilter(mockLogger)
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
    const filter = new AllExceptionsFilter(mockLogger)
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
    const filter = new AllExceptionsFilter(mockLogger)
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
    const filter = new AllExceptionsFilter(mockLogger)
    const statusFn = vi.fn().mockReturnThis()
    const jsonFn = vi.fn()
    const host = createMockHost(statusFn, jsonFn)

    filter.catch(new Error("unexpected"), host)

    expect(statusFn).toHaveBeenCalledWith(500)
  })
})
