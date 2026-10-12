import { describe, expect, it } from "vitest"
import { todoDeliveryRetryDelay } from "./todo-reminder-outbox"

describe("todo delivery backoff", () => {
  it("starts at a minute and caps at fifteen minutes", () => {
    expect([1, 2, 3, 10, 30].map(todoDeliveryRetryDelay)).toEqual([60000, 120000, 240000, 900000, 900000])
  })
})
