import type { IncomingHttpHeaders } from "node:http"

export type ClientTelemetryEnvironment = {
  readonly browserName?: string
  readonly browserVersion?: string
  readonly osName?: string
  readonly osVersion?: string
}

const versionPattern = /^[A-Za-z0-9._+-]{1,32}$/u

export function parseWebClientEnvironment(headers: IncomingHttpHeaders): ClientTelemetryEnvironment {
  const userAgent = headerText(headers["user-agent"])
  const browser = parseBrowser(
    headerText(headers["sec-ch-ua-full-version-list"]) ?? headerText(headers["sec-ch-ua"]),
    userAgent,
  )
  const operatingSystem = parseOperatingSystem(
    headerText(headers["sec-ch-ua-platform"]),
    headerText(headers["sec-ch-ua-platform-version"]),
    userAgent,
  )
  return { ...browser, ...operatingSystem }
}

export function parseDesktopClientEnvironment(headers: IncomingHttpHeaders): ClientTelemetryEnvironment {
  const osName = normalizeName(headerText(headers["x-synapse-telemetry-os-name"]))
  const osVersion = normalizeVersion(headerText(headers["x-synapse-telemetry-os-version"]))
  return {
    ...(osName ? { osName } : {}),
    ...(osVersion ? { osVersion } : {}),
  }
}

function parseBrowser(clientHints: string | undefined, userAgent: string | undefined): ClientTelemetryEnvironment {
  const hinted = parseBrowserClientHints(clientHints)
  if (hinted?.browserName !== "chromium") return hinted ?? parseUserAgentBrowser(userAgent)
  const derivative = userAgent
    ? matchBrowser(userAgent, "edge", /(?:EdgA|EdgiOS|Edg)\/([\d.]+)/u)
      ?? matchBrowser(userAgent, "opera", /(?:OPR|Opera)\/([\d.]+)/u)
      ?? matchBrowser(userAgent, "samsung-internet", /SamsungBrowser\/([\d.]+)/u)
    : null
  if (derivative) return derivative
  return hinted
}

function parseUserAgentBrowser(userAgent: string | undefined): ClientTelemetryEnvironment {
  if (!userAgent) return { browserName: "unknown" }

  return matchBrowser(userAgent, "edge", /(?:EdgA|EdgiOS|Edg)\/([\d.]+)/u)
    ?? matchBrowser(userAgent, "opera", /(?:OPR|Opera)\/([\d.]+)/u)
    ?? matchBrowser(userAgent, "samsung-internet", /SamsungBrowser\/([\d.]+)/u)
    ?? matchBrowser(userAgent, "firefox", /(?:FxiOS|Firefox)\/([\d.]+)/u)
    ?? matchBrowser(userAgent, "chrome", /(?:CriOS|Chrome)\/([\d.]+)/u)
    ?? matchBrowser(userAgent, "safari", /Version\/([\d.]+).*Safari\//u)
    ?? { browserName: "unknown" }
}

function parseBrowserClientHints(value: string | undefined): ClientTelemetryEnvironment | null {
  if (!value) return null
  const brands = [...value.matchAll(/"([^"]+)";v="([^"]+)"/gu)]
  const preferred = [
    { browserName: "edge", pattern: /Microsoft Edge/iu },
    { browserName: "opera", pattern: /Opera/iu },
    { browserName: "samsung-internet", pattern: /Samsung Internet/iu },
    { browserName: "chrome", pattern: /Google Chrome/iu },
    { browserName: "chromium", pattern: /^Chromium$/iu },
  ]
  for (const candidate of preferred) {
    const match = brands.find((brand) => candidate.pattern.test(brand[1] ?? ""))
    const version = normalizeVersion(match?.[2])
    if (match) return { browserName: candidate.browserName, ...(version ? { browserVersion: version } : {}) }
  }
  return null
}

function matchBrowser(userAgent: string, browserName: string, pattern: RegExp): ClientTelemetryEnvironment | null {
  const version = normalizeVersion(pattern.exec(userAgent)?.[1])
  return version ? { browserName, browserVersion: version } : null
}

function parseOperatingSystem(
  hintedPlatform: string | undefined,
  hintedVersion: string | undefined,
  userAgent: string | undefined,
): ClientTelemetryEnvironment {
  const platform = unquote(hintedPlatform)
  const platformVersion = normalizeVersion(unquote(hintedVersion))
  if (platform) {
    const osName = hintedOsName(platform, platformVersion)
    if (osName && platformVersion) return { osName, osVersion: platformVersion }
    const userAgentOperatingSystem = parseUserAgentOperatingSystem(userAgent)
    if (userAgentOperatingSystem.osName !== "unknown") return userAgentOperatingSystem
    if (osName) return { osName }
  }
  return parseUserAgentOperatingSystem(userAgent)
}

function parseUserAgentOperatingSystem(userAgent: string | undefined): ClientTelemetryEnvironment {
  if (!userAgent) return { osName: "unknown" }

  const windowsVersion = /Windows NT ([\d.]+)/u.exec(userAgent)?.[1]
  if (windowsVersion) return { osName: windowsName(windowsVersion), osVersion: windowsVersion }

  const iosVersion = /(?:CPU (?:iPhone )?OS|iPhone OS) ([\d_]+)/u.exec(userAgent)?.[1]
  if (iosVersion) return { osName: "ios", osVersion: iosVersion.replaceAll("_", ".") }

  const androidVersion = /Android ([\d.]+)/u.exec(userAgent)?.[1]
  if (androidVersion) return { osName: "android", osVersion: androidVersion }

  const macVersion = /Mac OS X ([\d_]+)/u.exec(userAgent)?.[1]
  if (macVersion) return { osName: "macos", osVersion: macVersion.replaceAll("_", ".") }

  if (/CrOS\b/u.test(userAgent)) return { osName: "chromeos" }
  if (/Linux\b/u.test(userAgent)) return { osName: "linux" }
  return { osName: "unknown" }
}

function hintedOsName(platform: string, version: string | undefined): string | null {
  const normalized = platform.toLowerCase()
  if (normalized === "windows") return windowsNameFromClientHint(version)
  if (normalized === "macos") return "macos"
  if (normalized === "linux") return "linux"
  if (normalized === "android") return "android"
  if (normalized === "ios") return "ios"
  if (normalized === "chrome os") return "chromeos"
  return null
}

function windowsNameFromClientHint(version: string | undefined): string | null {
  if (!version) return "windows-10-or-11"
  const [major, minor] = version.split(".").map(Number)
  if (major === 0 && minor === 1) return "windows-7"
  if (major === 0 && minor === 2) return "windows-8"
  if (major === 0 && minor === 3) return "windows-8.1"
  if (Number.isFinite(major) && major >= 13) return "windows-11"
  if (Number.isFinite(major) && major >= 1) return "windows-10"
  return null
}

function windowsName(version: string): string {
  const [major, minor, build] = version.split(".").map(Number)
  if (major === 6 && minor === 1) return "windows-7"
  if (major === 6 && minor === 2) return "windows-8"
  if (major === 6 && minor === 3) return "windows-8.1"
  if (major === 10 && minor === 0) {
    if (!Number.isFinite(build)) return "windows-10-or-11"
    return build >= 22_000 ? "windows-11" : "windows-10"
  }
  return "windows"
}

function normalizeVersion(value: string | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value.trim().slice(0, 32)
  return versionPattern.test(normalized) ? normalized : undefined
}

function normalizeName(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase()
  return normalized && /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(normalized) ? normalized : undefined
}

function unquote(value: string | undefined): string | undefined {
  return value?.trim().replace(/^"|"$/gu, "")
}

function headerText(value: string | readonly string[] | undefined): string | undefined {
  if (typeof value === "string" || value === undefined) return value
  return value[0]
}
