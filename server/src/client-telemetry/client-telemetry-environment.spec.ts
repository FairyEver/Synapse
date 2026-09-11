import { describe, expect, it } from "vitest"
import {
  parseDesktopClientEnvironment,
  parseWebClientEnvironment,
} from "./client-telemetry-environment"

describe("parseWebClientEnvironment", () => {
  it("parses Chrome on Windows 11 from client hints", () => {
    expect(parseWebClientEnvironment({
      "sec-ch-ua-full-version-list": '"Not_A Brand";v="99.0.0.0", "Chromium";v="140.0.7339.81", "Google Chrome";v="140.0.7339.81"',
      "sec-ch-ua-platform": '"Windows"',
      "sec-ch-ua-platform-version": '"15.0.0"',
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
    })).toEqual({
      browserName: "chrome",
      browserVersion: "140.0.7339.81",
      osName: "windows-11",
      osVersion: "15.0.0",
    })
  })

  it("falls back to Safari and macOS information from the user agent", () => {
    expect(parseWebClientEnvironment({
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6_1) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15",
    })).toEqual({
      browserName: "safari",
      browserVersion: "18.6",
      osName: "macos",
      osVersion: "15.6.1",
    })
  })

  it("recognizes Windows 7 and Firefox from the user agent", () => {
    expect(parseWebClientEnvironment({
      "user-agent": "Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0",
    })).toEqual({
      browserName: "firefox",
      browserVersion: "115.0",
      osName: "windows-7",
      osVersion: "6.1",
    })
  })

  it.each([
    ["0.1.0", "windows-7"],
    ["0.2.0", "windows-8"],
    ["0.3.0", "windows-8.1"],
  ])("maps legacy Windows client hint %s to %s", (platformVersion, osName) => {
    expect(parseWebClientEnvironment({
      "sec-ch-ua-platform": '"Windows"',
      "sec-ch-ua-platform-version": `"${platformVersion}"`,
      "user-agent": "Mozilla/5.0 (Windows NT 6.1; Win64; x64)",
    })).toMatchObject({ osName, osVersion: platformVersion })
  })

  it("keeps Samsung Internet distinct from generic Chromium hints", () => {
    expect(parseWebClientEnvironment({
      "sec-ch-ua": '"Chromium";v="140", "Not_A Brand";v="99"',
      "user-agent": "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36 SamsungBrowser/28.0",
    })).toMatchObject({
      browserName: "samsung-internet",
      browserVersion: "28.0",
    })
  })

  it("does not misclassify Windows 11 when version hints are unavailable", () => {
    expect(parseWebClientEnvironment({
      "sec-ch-ua": '"Chromium";v="140", "Google Chrome";v="140"',
      "sec-ch-ua-platform": '"Windows"',
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
    }).osName).toBe("windows-10-or-11")
  })
})

describe("parseDesktopClientEnvironment", () => {
  it("accepts only normalized operating-system headers", () => {
    expect(parseDesktopClientEnvironment({
      "x-synapse-telemetry-os-name": "windows-11",
      "x-synapse-telemetry-os-version": "10.0.26100",
    })).toEqual({ osName: "windows-11", osVersion: "10.0.26100" })
    expect(parseDesktopClientEnvironment({
      "x-synapse-telemetry-os-name": "Windows 11",
      "x-synapse-telemetry-os-version": "invalid version",
    })).toEqual({})
  })
})
