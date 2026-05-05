import { afterEach, describe, expect, it, vi } from "vitest"
import { getLicenseServerUrl, isDevLicenseServer } from "../constants"

describe("license constants", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("returns production URL by default", () => {
    vi.stubEnv("SYNAPSE_LICENSE_SERVER_URL", "")
    expect(getLicenseServerUrl()).toBe("https://synapse.d2.pub")
  })

  it("returns env override when set", () => {
    vi.stubEnv("SYNAPSE_LICENSE_SERVER_URL", "http://localhost:3000")
    expect(getLicenseServerUrl()).toBe("http://localhost:3000")
  })

  it("reports dev mode when env is set", () => {
    vi.stubEnv("SYNAPSE_LICENSE_SERVER_URL", "http://localhost:3000")
    expect(isDevLicenseServer()).toBe(true)
  })

  it("reports production mode when env is empty", () => {
    vi.stubEnv("SYNAPSE_LICENSE_SERVER_URL", "")
    expect(isDevLicenseServer()).toBe(false)
  })
})
