import { describe, expect, it } from "vitest"
import {
  JSON_REPAIR_ERROR_CODES,
  JSON_REPAIR_ERROR_MESSAGES,
  createJsonRepairErrorPayload,
  jsonRepairErrorPayloadSchema,
} from "../errors"

describe("jsonRepairErrorPayloadSchema", () => {
  it("accepts only the fixed message and retryability for every error code", () => {
    for (const code of JSON_REPAIR_ERROR_CODES) {
      const payload = createJsonRepairErrorPayload(
        code,
        code === "INVALID_INPUT"
          ? { field: "text", reason: "empty" }
          : undefined,
      )

      expect(jsonRepairErrorPayloadSchema.parse(payload)).toEqual(payload)
      expect(jsonRepairErrorPayloadSchema.safeParse({
        ...payload,
        message: `${JSON_REPAIR_ERROR_MESSAGES[code]} changed`,
      }).success).toBe(false)
      expect(jsonRepairErrorPayloadSchema.safeParse({
        ...payload,
        retryable: true,
      }).success).toBe(false)
    }
  })

  it("allows data only on INVALID_INPUT and keeps it strict", () => {
    expect(jsonRepairErrorPayloadSchema.safeParse({
      code: "NO_JSON_FOUND",
      message: JSON_REPAIR_ERROR_MESSAGES.NO_JSON_FOUND,
      retryable: false,
      data: { field: "text", reason: "empty" },
    }).success).toBe(false)
    expect(jsonRepairErrorPayloadSchema.safeParse({
      code: "INVALID_INPUT",
      message: JSON_REPAIR_ERROR_MESSAGES.INVALID_INPUT,
      retryable: false,
      data: { field: "text", reason: "empty", actual: "private" },
    }).success).toBe(false)
  })
})
