import type { MainAppCapabilityManifest } from "../../manifest"
import { PROBLEM_FEEDBACK_APP_ID } from "./capability"

export const problemFeedbackCapabilityManifest = {
  id: PROBLEM_FEEDBACK_APP_ID,
  deepLinks: [],
} as const satisfies MainAppCapabilityManifest
