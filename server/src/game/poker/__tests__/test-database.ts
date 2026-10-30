export function gameTestDatabaseUrl(): string | undefined {
  const value = process.env.GAME_E2E_DATABASE_URL
  if (!value) return undefined
  const url = new URL(value)
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !decodeURIComponent(url.pathname).endsWith("_e2e")
  )
    throw new Error("GAME_E2E_DATABASE_URL只允许本机_e2e专用测试库")
  return value
}
