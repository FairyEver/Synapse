export function requireLoopbackE2eDatabase(value, envName) {
  let url, database
  try { url = new URL(value); database = decodeURIComponent(url.pathname.slice(1)) }
  catch { throw new Error(`${envName} must be a valid PostgreSQL URL`) }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "")
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["localhost", "127.0.0.1", "::1"].includes(hostname) || !database.endsWith("_e2e")) {
    throw new Error(`${envName} requires a loopback PostgreSQL database ending in _e2e`)
  }
  return url.toString()
}
