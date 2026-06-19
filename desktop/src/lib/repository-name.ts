const WINDOWS_RESERVED_REPOSITORY_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const WINDOWS_ILLEGAL_REPOSITORY_NAME_CHARS = /[<>:"|?*\x00-\x1f]/

function normalizeLocalRepositoryNameInput(value: string): string {
  return value.trim()
}

function validateLocalRepositoryNameInput(value: string): string | null {
  const name = normalizeLocalRepositoryNameInput(value)

  if (!name) {
    return "本地仓库名称不能为空。"
  }

  if (name === "." || name === "..") {
    return "本地仓库名称不能是 . 或 ..。"
  }

  if (/[\\/]/.test(name)) {
    return "本地仓库名称不能包含斜杠。"
  }

  if (
    WINDOWS_ILLEGAL_REPOSITORY_NAME_CHARS.test(name)
    || /[. ]$/.test(value)
    || WINDOWS_RESERVED_REPOSITORY_NAMES.test(name)
  ) {
    return "本地仓库名称不能使用 Windows 非法文件名。"
  }

  return null
}

export {
  normalizeLocalRepositoryNameInput,
  validateLocalRepositoryNameInput,
}
