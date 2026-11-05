import { requireLoopbackE2eDatabase } from "./e2e-database-guard.mjs"
export function requireMailTriggerTestDatabase(value) {
  return requireLoopbackE2eDatabase(value, "MAIL_TRIGGERS_E2E_DATABASE_URL")
}
if (process.argv[1]?.endsWith("mail-triggers-e2e-database-guard.mjs")) requireMailTriggerTestDatabase(process.env.MAIL_TRIGGERS_E2E_DATABASE_URL)
