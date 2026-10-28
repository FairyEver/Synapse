import { describe, expect, it } from "vitest"
import { mapNotificationImageUploadResponse } from "../upload-outcome"

describe("mapNotificationImageUploadResponse", () => {
  it("reads the image id from a successful response", () => {
    expect(mapNotificationImageUploadResponse(201, { imageId: "img-1" })).toEqual({ status: "uploaded", imageId: "img-1" })
    expect(mapNotificationImageUploadResponse(200, {})).toEqual({ status: "failed" })
  })

  it("treats missing endpoints and contract 4xx as an outdated server", () => {
    expect(mapNotificationImageUploadResponse(404, undefined)).toEqual({ status: "service_outdated" })
    expect(mapNotificationImageUploadResponse(405, undefined)).toEqual({ status: "service_outdated" })
    expect(mapNotificationImageUploadResponse(400, { message: "bad" })).toEqual({ status: "service_outdated" })
  })

  it("separates credential failures and transient failures", () => {
    expect(mapNotificationImageUploadResponse(401, undefined)).toEqual({ status: "not_signed_in" })
    expect(mapNotificationImageUploadResponse(403, undefined)).toEqual({ status: "not_signed_in" })
    expect(mapNotificationImageUploadResponse(500, undefined)).toEqual({ status: "failed" })
    expect(mapNotificationImageUploadResponse(0, undefined)).toEqual({ status: "failed" })
  })
})
