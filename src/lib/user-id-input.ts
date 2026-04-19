const INVALID_USER_ID_INPUT_MESSAGE = "ID 格式不对，应为 32 位十六进制字符。"

function normalizeUserIdInput(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, "")
}

function validateUserIdInput(value: string): string | null {
  const normalizedValue = normalizeUserIdInput(value)

  if (!normalizedValue) {
    return INVALID_USER_ID_INPUT_MESSAGE
  }

  return /^[0-9a-f]{32}$/.test(normalizedValue)
    ? null
    : INVALID_USER_ID_INPUT_MESSAGE
}

export {
  normalizeUserIdInput,
  validateUserIdInput,
}
