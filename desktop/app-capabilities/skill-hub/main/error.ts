export class SkillHubDesktopError extends Error {
  constructor(readonly code: string, message: string, readonly data?: Record<string, unknown>) {
    super(message)
    this.name = "SkillHubDesktopError"
  }
}

export const hubAccountChanged = () => new SkillHubDesktopError("HUB_ACCOUNT_CHANGED", "账号已切换，请在原账号下确认上次操作。")
export const hubSourceExpired = () => new SkillHubDesktopError("HUB_SOURCE_EXPIRED", "准备结果已失效，请重新准备文件。")
