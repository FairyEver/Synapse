import { describe, expect, it } from "vitest"

import { resolveEnvironmentLabel, resolveWindowTitle } from "../window-title"

function label(apiBaseUrl: string, isPackaged = false): string {
  return resolveEnvironmentLabel({ apiBaseUrl, isPackaged })
}

describe("resolveEnvironmentLabel", () => {
  it("labels a local API as dev", () => {
    expect(label("http://localhost:3000/api")).toBe("dev")
    expect(label("http://127.0.0.1:3001/api")).toBe("dev")
  })

  it("labels the production API as dev:prod", () => {
    expect(label("https://synapse.d2.pub/api")).toBe("dev:prod")
  })

  it("names any other host instead of guessing", () => {
    // Naming it is honest; calling someone's own server "dev" would not be.
    expect(label("https://staging.example.com/api")).toBe("staging.example.com")
    expect(label("http://192.168.1.20:3001/api")).toBe("192.168.1.20")
  })

  it("adds no label to a packaged build", () => {
    expect(label("https://synapse.d2.pub/api", true)).toBe("")
    expect(label("http://localhost:3000/api", true)).toBe("")
  })

  it("adds no label when the URL cannot be read", () => {
    expect(label("")).toBe("")
    expect(label("not a url")).toBe("")
  })
})

describe("resolveWindowTitle", () => {
  it("composes the version and the environment", () => {
    expect(resolveWindowTitle({
      version: "0.2.468",
      apiBaseUrl: "http://localhost:3000/api",
      isPackaged: false,
    })).toBe("Synapse AI Studio 0.2.468 dev")

    expect(resolveWindowTitle({
      version: "0.2.468",
      apiBaseUrl: "https://synapse.d2.pub/api",
      isPackaged: false,
    })).toBe("Synapse AI Studio 0.2.468 dev:prod")
  })

  it("leaves the packaged title as the bare product name and version", () => {
    expect(resolveWindowTitle({
      version: "0.2.468",
      apiBaseUrl: "https://synapse.d2.pub/api",
      isPackaged: true,
    })).toBe("Synapse AI Studio 0.2.468")
  })
})
