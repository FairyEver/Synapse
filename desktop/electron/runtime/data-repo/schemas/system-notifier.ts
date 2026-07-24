import {
  systemNotifierSettingsSchema,
  type SystemNotifierSettings,
} from "../../../../app-capabilities/system-notifier/shared/schema"
import { SYSTEM_NOTIFIER_SETTINGS_NAMESPACE } from "../../../../app-capabilities/system-notifier/shared/capability"
import type { NamespaceSchema } from "../types"

export interface SystemNotifierSettingsEntryV1 extends SystemNotifierSettings, Record<string, unknown> {}

export const systemNotifierSettingsSchemaDefinition: NamespaceSchema<SystemNotifierSettingsEntryV1> = {
  name: SYSTEM_NOTIFIER_SETTINGS_NAMESPACE,
  backend: "json",
  currentVersion: 1,
  migrations: [],
  validate: (value): value is SystemNotifierSettingsEntryV1 =>
    systemNotifierSettingsSchema.safeParse(value).success,
  encrypted: false,
}
