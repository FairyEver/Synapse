import type { CapabilityId } from "../../../synapse-capabilities/shared/naming"

export const SOUND_NOTIFIER_APP_ID = "sound-notifier" as const
export const SOUND_NOTIFIER_SETTINGS_NAMESPACE = "app.sound-notifier.settings" as const
export const SOUND_NOTIFIER_PLAY_CAPABILITY_ID =
  "app.sound_notifier.sound.play" as CapabilityId
export const SOUND_NOTIFIER_PLAY_MCP_TOOL_NAME = "app_sound_notifier_sound_play" as const
