import { requireLoopbackE2eDatabase } from "./e2e-database-guard.mjs"
export function requireDriveDiscussionTestDatabase(value) {
  return requireLoopbackE2eDatabase(value, "DRIVE_DISCUSSION_E2E_DATABASE_URL")
}
if (process.argv[1]?.endsWith("drive-discussion-e2e-database-guard.mjs")) requireDriveDiscussionTestDatabase(process.env.DRIVE_DISCUSSION_E2E_DATABASE_URL)
