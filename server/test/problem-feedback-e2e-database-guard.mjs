import { requireLoopbackE2eDatabase } from "./e2e-database-guard.mjs"
requireLoopbackE2eDatabase(process.env.PROBLEM_FEEDBACK_E2E_DATABASE_URL, "PROBLEM_FEEDBACK_E2E_DATABASE_URL")
