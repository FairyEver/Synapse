import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const electronMock = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(),
  },
}))

vi.mock("electron", () => electronMock)

vi.mock("../../services/log-store", () => ({
  createMainLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

let tempDir = ""
let service: typeof import("../service").dataStoreService

describe("DataStoreService table descriptions", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-data-store-"))
    electronMock.app.getPath.mockReturnValue(tempDir)
    vi.resetModules()

    const module = await import("../service")
    service = module.dataStoreService
    service.open()
  })

  afterEach(async () => {
    service.close()
    await rm(tempDir, { recursive: true, force: true })
    electronMock.app.getPath.mockReset()
  })

  it("updates table descriptions in list and schema metadata", () => {
    service.createTable(
      "customer_orders",
      [{ name: "customer_name", kind: "text" }],
      "old note",
    )

    service.updateTableDescription("customer_orders", "客户订单")

    expect(service.describeTable("customer_orders").description).toBe("客户订单")
    expect(service.listTables()).toContainEqual(expect.objectContaining({
      name: "customer_orders",
      description: "客户订单",
    }))
  })

  it("allows clearing a table description", () => {
    service.createTable(
      "product_sku",
      [{ name: "sku_code", kind: "text" }],
      "商品编码",
    )

    service.updateTableDescription("product_sku", "")

    expect(service.describeTable("product_sku").description).toBe("")
    expect(service.listTables()).toContainEqual(expect.objectContaining({
      name: "product_sku",
      description: "",
    }))
  })
})
