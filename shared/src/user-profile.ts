export const userNicknameMaxLength = 24

const nicknameControlCharacterPattern = /[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/u

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
