export { intervalTriggerManifest } from "./manifest"
export {
  intervalTriggerConfigSchema,
  type IntervalTriggerConfig,
} from "./schema"

export function summarizeIntervalTriggerConfig(config: {
  readonly everyMinutes: number
  readonly anchor: "created_at" | "last_completed_at"
}): string {
  return config.anchor === "last_completed_at"
    ? `每 ${config.everyMinutes} 分钟 · 完成后`
    : `每 ${config.everyMinutes} 分钟`
}
