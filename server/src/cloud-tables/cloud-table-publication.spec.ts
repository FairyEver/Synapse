import { describe, expect, it } from "vitest"
import { cloudTablePublicationStatus } from "./cloud-table-publication"

describe("cloud table publication preflight", () => {
  it.each([
    ["http://localhost:19700", "local_only"],
    ["https://127.0.0.2", "local_only"],
    ["https://[::ffff:192.168.1.5]", "local_only"],
    ["https://app.local", "local_only"],
    ["http://app.example.com", "https_required"],
    ["https://app.example.com", "external_verification_required"],
    ["https://[2606:4700::1111]", "external_verification_required"],
  ])("classifies %s without claiming it was verified externally", (url, audience) => {
    expect(cloudTablePublicationStatus(url)).toEqual({ publicAppUrl: new URL(url).origin, audience })
  })

  it.each([undefined, "https://user:password@example.com/", "https://app.example.com/api", "https://app.example.com/?token=value"])("does not return unsafe configuration %s", url => {
    expect(cloudTablePublicationStatus(url)).toEqual({ publicAppUrl: null, audience: "unconfigured" })
  })
})
