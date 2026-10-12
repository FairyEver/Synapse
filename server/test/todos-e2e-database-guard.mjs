import { requireLoopbackE2eDatabase } from "./e2e-database-guard.mjs"
export function requireTodosTestDatabase(value) {
  return requireLoopbackE2eDatabase(value, "TODOS_E2E_DATABASE_URL")
}
if (process.argv[1]?.endsWith("todos-e2e-database-guard.mjs")) requireTodosTestDatabase(process.env.TODOS_E2E_DATABASE_URL)
