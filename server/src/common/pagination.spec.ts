import { BadRequestException } from "@nestjs/common"
import { describe, expect, it } from "vitest"
import { parsePagination, toPrismaArgs } from "./pagination"

describe("pagination", () => {
  it("uses defaults when no params provided", () => {
    const result = parsePagination({})
    expect(result.page).toBe(1)
    expect(result.pageSize).toBe(20)
    expect(result.sortOrder).toBe("desc")
  })

  it("parses string numbers from query params", () => {
    const result = parsePagination({ page: "3", pageSize: "50" })
    expect(result.page).toBe(3)
    expect(result.pageSize).toBe(50)
  })

  it("rejects pageSize > 100 with bad request", () => {
    expect(() => parsePagination({ pageSize: "200" })).toThrow(BadRequestException)
  })

  it("rejects page < 1 with bad request", () => {
    expect(() => parsePagination({ page: "0" })).toThrow(BadRequestException)
  })

  it("rejects non-numeric pageSize with bad request", () => {
    expect(() => parsePagination({ pageSize: "abc" })).toThrow(BadRequestException)
  })

  it("rejects sort fields outside the default allowlist", () => {
    expect(() => parsePagination({ sortBy: "passwordHash" })).toThrow("排序字段无效。")
  })

  it("accepts resource-specific sort fields", () => {
    const result = parsePagination({ sortBy: "email", sortOrder: "asc" }, {
      allowedSortFields: ["createdAt", "email"],
    })
    expect(result.sortBy).toBe("email")
    expect(result.sortOrder).toBe("asc")
  })

  it("converts to Prisma skip/take/orderBy", () => {
    const pagination = parsePagination({ page: "2", pageSize: "10" })
    const args = toPrismaArgs(pagination)
    expect(args.skip).toBe(10)
    expect(args.take).toBe(10)
    expect(args.orderBy).toEqual({ createdAt: "desc" })
  })
})
