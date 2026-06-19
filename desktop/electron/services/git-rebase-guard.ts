import { isGitRebaseInProgress } from "./git-command"

const PREEXISTING_GIT_REBASE_MESSAGE = "当前仓库正在进行 rebase，请先在 Git 工具中完成或中止后再重试。"

type PreexistingGitRebaseListener = (localPath: string) => void

async function assertNoPreexistingGitRebase(
  localPath: string,
  onDetected?: PreexistingGitRebaseListener,
): Promise<void> {
  if (!(await isGitRebaseInProgress(localPath))) {
    return
  }

  onDetected?.(localPath)
  throw new Error(PREEXISTING_GIT_REBASE_MESSAGE)
}

export {
  assertNoPreexistingGitRebase,
  PREEXISTING_GIT_REBASE_MESSAGE,
}
