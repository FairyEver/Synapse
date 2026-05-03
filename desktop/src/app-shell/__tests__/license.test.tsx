import { describe, expect, it } from "vitest"
import { formatLicenseErrorMessage } from "../license"

describe("formatLicenseErrorMessage", () => {
  it("maps activation rate limit codes", () => {
    expect(formatLicenseErrorMessage(
      Object.assign(new Error("raw"), { code: "ACTIVATION_RATE_LIMITED" }),
      "激活失败。",
    )).toBe("尝试过于频繁，请稍后再试。")
  })

  it("maps activation risk lock codes", () => {
    expect(formatLicenseErrorMessage(
      Object.assign(new Error("raw"), { code: "ACTIVATION_RISK_LOCKED" }),
      "激活失败。",
    )).toBe("激活码暂不可用，请联系管理员。")
  })
})
