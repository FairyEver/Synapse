import type { AutomationTriggerDefinition } from "../../types.shared"
import { matchesMailReceivedEvent, summarizeMailReceivedConfig } from "./filter"
import { mailReceivedManifest } from "./manifest"

export const mailReceivedDefinition = {
  activationRequired: true,
  manifest: mailReceivedManifest,
  summarize: config => summarizeMailReceivedConfig(config),
  runtime: {
    shouldAcceptEvent: ({ config, event }) => matchesMailReceivedEvent(config, event),
  },
} satisfies AutomationTriggerDefinition
