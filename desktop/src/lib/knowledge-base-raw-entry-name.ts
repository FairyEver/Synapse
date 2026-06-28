const WINDOWS_RESERVED_RAW_ENTRY_BASENAME_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu
const WINDOWS_UNSAFE_RAW_ENTRY_CHAR_PATTERN = /[<>:"|?*\u0000-\u001F]/u

function validateKnowledgeBaseRawEntryNameInput(value: string): string | null {
  const trimmed = value.trim()

  if (!trimmed) {
    return "请输入名称。"
  }

  if (value !== trimmed) {
    return "名称包含 Windows 不支持的字符或保留名。"
  }

  if (trimmed === "."
    || trimmed === ".."
    || /[\\/]/.test(trimmed)
    || WINDOWS_UNSAFE_RAW_ENTRY_CHAR_PATTERN.test(trimmed)
    || /[. ]$/u.test(value)
    || WINDOWS_RESERVED_RAW_ENTRY_BASENAME_PATTERN.test(trimmed)) {
    return "名称包含 Windows 不支持的字符或保留名。"
  }

  return null
}

export {
  validateKnowledgeBaseRawEntryNameInput,
}
