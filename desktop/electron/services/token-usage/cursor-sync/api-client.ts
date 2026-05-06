import type { CursorValidateResult } from "./types"
import { createMainLogger } from "../../log-store"

const logger = createMainLogger("cursor-api")

const USAGE_CSV_ENDPOINT = "https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens"
const USAGE_SUMMARY_ENDPOINT = "https://cursor.com/api/usage-summary"

function buildHeaders(sessionToken: string): Record<string, string> {
  return {
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Cookie: `WorkosCursorSessionToken=${sessionToken}`,
    Referer: "https://www.cursor.com/settings",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  }
}

export async function validateCursorSession(sessionToken: string): Promise<CursorValidateResult> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)

    const response = await fetch(USAGE_SUMMARY_ENDPOINT, {
      headers: buildHeaders(sessionToken),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: "Session token expired or invalid" }
    }
    if (!response.ok) {
      return { valid: false, error: `API returned status ${response.status}` }
    }

    const data = await response.json() as Record<string, unknown>
    const hasBillingStart = typeof data.billingCycleStart === "string"
    const hasBillingEnd = typeof data.billingCycleEnd === "string"

    if (hasBillingStart && hasBillingEnd) {
      const membershipType = typeof data.membershipType === "string" ? data.membershipType : undefined
      return { valid: true, membershipType }
    }

    return { valid: false, error: "Invalid response format" }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { valid: false, error: "Request timed out" }
    }
    return { valid: false, error: `Failed to connect: ${String(error)}` }
  }
}

export async function fetchCursorUsageCsv(sessionToken: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)

  let response: Response
  try {
    response = await fetch(USAGE_CSV_ENDPOINT, {
      headers: buildHeaders(sessionToken),
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timeout)
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Cursor CSV download timed out")
    }
    throw new Error(`Failed to connect to Cursor API: ${String(error)}`)
  }
  clearTimeout(timeout)

  if (response.status === 401 || response.status === 403) {
    throw new Error("Cursor session expired. Please re-authenticate.")
  }
  if (!response.ok) {
    throw new Error(`Cursor API returned status ${response.status}`)
  }

  const text = await response.text()
  if (!text.startsWith("Date,")) {
    throw new Error("Invalid response from Cursor API - expected CSV format")
  }

  return text
}
