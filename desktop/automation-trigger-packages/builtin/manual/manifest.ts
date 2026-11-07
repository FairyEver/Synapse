import { commonTriggerVariables } from "../common-variables"
import type { AutomationTriggerManifest } from "../../types.shared"
import { manualTriggerConfigSchema, type ManualTriggerConfig } from "./schema"

export const manualTriggerManifest = {
  id: "builtin.manual",
  title: "手动触发",
  kind: "manual",
  defaultConfig: {},
  configSchema: manualTriggerConfigSchema,
  variables: commonTriggerVariables("manual"),
} satisfies AutomationTriggerManifest<ManualTriggerConfig>
