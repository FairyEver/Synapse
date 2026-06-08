// 基础时间单位：用于派生全局配置里的 1 小时时长，避免重复写魔法数字。
const ONE_HOUR_MS = 60 * 60 * 1000

// Agent 会话在最近活动结束后超过该时长时，提示用户新建对话以避免继续沿用长上下文。
export const CONVERSATION_IDLE_ROLLOVER_PROMPT_MS = ONE_HOUR_MS
