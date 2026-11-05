import type { RendererAutomationTriggerDefinition } from "../../types.shared"
import { CronTriggerConfigForm } from "./config.renderer"
import { validateCronExpression } from "../../../src/automation-triggers/cron-utils"
import {
  cronTriggerManifest,
  summarizeCronTriggerConfig,
  type CronTriggerConfig,
} from "./index.shared"

export const cronRendererTriggerDefinition = {
  manifest: cronTriggerManifest,
  summarizeConfig: summarizeCronTriggerConfig,
  validateConfig(config: CronTriggerConfig) {
    const result = validateCronExpression(config.expr)
    if (!result.ok) throw new Error(result.message)
    if (config.timezone) {
      try {
        new Intl.DateTimeFormat("zh-CN", { timeZone: config.timezone })
      } catch {
        throw new Error("请填写有效时区，例如 Asia/Shanghai")
      }
    }
  },
  ConfigForm: CronTriggerConfigForm,
} satisfies RendererAutomationTriggerDefinition<CronTriggerConfig>
