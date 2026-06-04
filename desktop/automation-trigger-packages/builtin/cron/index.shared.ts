export { cronTriggerManifest } from "./manifest"
export {
  cronTriggerConfigSchema,
  type CronTriggerConfig,
} from "./schema"

export function summarizeCronTriggerConfig(config: { readonly expr: string }): string {
  return `Cron · ${config.expr}`
}
