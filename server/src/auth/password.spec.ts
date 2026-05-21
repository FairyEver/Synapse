import { describe, expect, it } from "vitest"
import { hashPassword, verifyPassword } from "./password"

describe("password utilities", () => {
  it("verifies a hashed password", async () => {
    const hash = await hashPassword("StrongPassword123!")

    await expect(verifyPassword("StrongPassword123!", hash)).resolves.toBe(true)
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false)
  })
})
