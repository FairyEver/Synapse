const value = process.env.PROBLEM_FEEDBACK_E2E_DATABASE_URL

let url
try {
  url = new URL(value)
} catch {
  throw new Error("PROBLEM_FEEDBACK_E2E_DATABASE_URL must be a valid PostgreSQL URL.")
}

const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "")
const database = decodeURIComponent(url.pathname.replace(/^\//u, ""))
if (
  !["postgres:", "postgresql:"].includes(url.protocol)
  || !["localhost", "127.0.0.1", "::1"].includes(hostname)
  || !database.endsWith("_e2e")
) {
  throw new Error(
    "Problem feedback e2e tests require a loopback PostgreSQL database ending in _e2e.",
  )
}
