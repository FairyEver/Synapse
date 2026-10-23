import { describe, expect, it } from "vitest"
import { parseMailReference, mailCapabilityManifest } from "../manifest"

describe("external mail reference", () => {
  const id = "em_e69940c0-4db1-4a0a-8f87-9027d116e194"
  it("accepts only opaque external mail IDs in the mail domain", () => {
    expect(parseMailReference(`synapse://mail/${id}`)).toBe(id)
    for (const raw of ["synapse://mail/cuid-old", `synapse://mail-internal/${id}`, `synapse://mail/${id}?`, `synapse://mail/${id}#x`, `synapse://mail/${id}/x`, `synapse://mail/%65${id.slice(1)}`]) {
      expect(parseMailReference(raw)).toBeNull()
    }
    expect(mailCapabilityManifest.protocolRoutes).toHaveLength(1)
  })
})
