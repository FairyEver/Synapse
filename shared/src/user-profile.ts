export const userNicknameMaxLength = 24

/**
 * 控制字符（C0/C1）与格式字符（Unicode 类别 Cf：双向控制、零宽连接符、BOM、软连字符等）。
 *
 * 用 `\p{Cf}` 把整族一起挡掉：它们的共同点是不可见却影响排版，只列常见几个会漏掉方向
 * 覆盖（U+202E 之类），而昵称会出现在桌面账号区、消息中心和控制台列表里，一个不可见的
 * 方向覆盖足以让某一行显示成另一个名字。
 */
const nicknameControlCharacterPattern = /[\u0000-\u001F\u007F-\u009F\p{Cf}]/u

export function normalizeUserNickname(value: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error("昵称不能为空。")
  if ([...normalized].length > userNicknameMaxLength) {
    throw new Error(`昵称不能超过 ${userNicknameMaxLength} 个字符。`)
  }
  if (nicknameControlCharacterPattern.test(normalized)) throw new Error("昵称不能包含控制字符。")
  return normalized
}

export function buildDefaultUserNickname(handle: string): string {
  return [...handle.trim()].slice(0, userNicknameMaxLength).join("")
}
