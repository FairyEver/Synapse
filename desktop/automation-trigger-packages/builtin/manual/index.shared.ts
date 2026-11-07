export { manualTriggerManifest } from "./manifest"
export {
  manualTriggerConfigSchema,
  type ManualTriggerConfig,
} from "./schema"

export function summarizeManualTriggerConfig(): string {
  return "手动触发"
}
