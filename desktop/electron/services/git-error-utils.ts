export function formatGitFailureMessage(
  output: string,
  fallbackMessage: string,
): string {
  const normalizedOutput = output.trim()
  const firstLine = normalizedOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  const loweredOutput = normalizedOutput.toLowerCase()

  // 认证相关
  if (
    loweredOutput.includes("authentication failed")
    || loweredOutput.includes("could not read username")
    || loweredOutput.includes("permission denied (publickey)")
    || loweredOutput.includes("permission denied")
    || loweredOutput.includes("fatal: could not read from remote repository")
  ) {
    return "Git 认证失败。请检查系统凭证、SSH Key 或 credential.helper 配置。"
  }

  // 仓库不存在
  if (
    loweredOutput.includes("repository not found")
    || loweredOutput.includes("not found")
    || loweredOutput.includes("no such remote")
  ) {
    return "当前仓库没有可用的远程配置，或当前账号没有访问权限。"
  }

  // 网络问题
  if (
    loweredOutput.includes("could not resolve host")
    || loweredOutput.includes("failed to connect")
    || loweredOutput.includes("connection timed out")
    || loweredOutput.includes("network is unreachable")
    || loweredOutput.includes("connection reset")
  ) {
    return "无法连接到远程仓库。请检查网络连接、代理设置或仓库域名。"
  }

  // 分支问题
  if (
    loweredOutput.includes("there is no tracking information for the current branch")
    || loweredOutput.includes("no upstream configured for branch")
    || loweredOutput.includes("has no upstream branch")
  ) {
    return "当前分支还没有配置上游分支，暂时无法在 Synapse 中执行同步。"
  }

  // 快进失败
  if (loweredOutput.includes("not possible to fast-forward")) {
    return "当前仓库无法快进同步，请先在你常用的 Git 工具里处理分支分叉。"
  }

  // 非 Git 仓库
  if (loweredOutput.includes("not a git repository")) {
    return "当前目录不是 Git 仓库，无法执行同步。"
  }

  // .gitignore 忽略
  if (
    loweredOutput.includes("paths are ignored by one of your .gitignore files")
    || loweredOutput.includes("the following paths are ignored")
  ) {
    return "目标内容目录被 .gitignore 忽略了，请先调整仓库规则后再试。"
  }

  // 无变更
  if (
    loweredOutput.includes("nothing to commit")
    || loweredOutput.includes("no changes added to commit")
  ) {
    return "当前没有可提交的改动。"
  }

  return firstLine ? `${fallbackMessage}\n${firstLine}` : fallbackMessage
}
