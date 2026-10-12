export function requireTodosTestDatabase(value) {
  let url
  try { url = new URL(value) } catch { throw new Error("TODOS_E2E_DATABASE_URL must be a valid PostgreSQL URL") }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "")
  const database = decodeURIComponent(url.pathname.slice(1))
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1", "::1"].includes(hostname) || !database.endsWith("_e2e")) {
    throw new Error("Todo e2e tests require a loopback PostgreSQL database ending in _e2e")
  }
  return url.toString()
}
if (process.argv[1]?.endsWith("todos-e2e-database-guard.mjs")) requireTodosTestDatabase(process.env.TODOS_E2E_DATABASE_URL)
