import type { ActionConfig } from "../types"

const WINDOWS_DEFAULT_SHELL = "cmd"

function createPlatformActionDefaultConfig(
  actionType: string,
  defaultConfig: ActionConfig,
  platform?: string,
): ActionConfig {
  if (platform === "win32" && isShellActionType(actionType)) {
    return {
      ...defaultConfig,
      shell: WINDOWS_DEFAULT_SHELL,
    }
  }

  return { ...defaultConfig }
}

function isShellActionType(actionType: string): boolean {
  return actionType === "builtin.command" || actionType === "builtin.script"
}

export {
  createPlatformActionDefaultConfig,
  isShellActionType,
  WINDOWS_DEFAULT_SHELL,
}
