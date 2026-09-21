import { createGitClientCommandRunner, type GitClientCommandRunner } from "../git-client/git-command-runner"
import { createTerminalGitIntegration, type TerminalGitIntegration } from "./terminal-git-integration"
import {
  createTerminalGitBranchValidator,
  createTerminalGitStatusReader,
  type TerminalGitStatusReader,
} from "./terminal-git-status"
import { createTerminalGitWorkflow, type TerminalGitWorkflow } from "./terminal-git-workflow"
import type { TerminalGitBranch, TerminalGitSnapshot } from "./terminal-git-types"

export type { TerminalGitBranch, TerminalGitSnapshot } from "./terminal-git-types"

/**
 * 按终端当前目录跑 git。
 *
 * 这一层**只认路径**：不接「代码仓库」注册表、不产生 `repositories.json` 条目、
 * 不要求用户先添加仓库。它复用的只有 `git-client` 里的命令封装与解析器
 * （`git-command.ts` / `git-command-runner.ts` / `git-status-parser.ts`），
 * 那些东西本来就只吃路径。
 *
 * 命令全部走 `runGitCommand`，而它的安全策略在 bootstrap 一次性接好了
 * （actor 为 system，走 `systemShellExecPolicy`）—— 只要走它，权限与审计自动就过了，
 * 不需要为核心路径再写一遍。**也正因如此，这里不得出现任何绕过它的直接 spawn。**
 */
export type TerminalGitService = {
  readonly getSnapshot: TerminalGitStatusReader["getSnapshot"]
  readonly isRepository: TerminalGitStatusReader["isRepository"]
  readonly listBranches: TerminalGitStatusReader["listBranches"]
  readonly checkout: TerminalGitWorkflow["checkout"]
  readonly createBranch: TerminalGitWorkflow["createBranch"]
  readonly commit: TerminalGitWorkflow["commit"]
  readonly push: TerminalGitWorkflow["push"]
  readonly sync: TerminalGitWorkflow["sync"]
  readonly merge: TerminalGitIntegration["merge"]
}

export function createTerminalGitService(deps: {
  readonly logger?: { error(message: string, meta?: unknown): void; warn(message: string, meta?: unknown): void }
  readonly commandRunner?: GitClientCommandRunner
} = {}): TerminalGitService {
  const commandRunner = deps.commandRunner ?? createGitClientCommandRunner({
    ...(deps.logger ? { logger: { error: deps.logger.error.bind(deps.logger) } } : {}),
  })
  const status = createTerminalGitStatusReader({ commandRunner })
  const validateBranchName = createTerminalGitBranchValidator({ commandRunner })
  const workflow = createTerminalGitWorkflow({ commandRunner, status, validateBranchName })
  const integration = createTerminalGitIntegration({
    commandRunner,
    status,
    validateBranchName,
    ...(deps.logger ? { logger: deps.logger } : {}),
  })

  return {
    getSnapshot: status.getSnapshot,
    isRepository: status.isRepository,
    listBranches: status.listBranches,
    checkout: workflow.checkout,
    createBranch: workflow.createBranch,
    commit: workflow.commit,
    push: workflow.push,
    sync: workflow.sync,
    merge: integration.merge,
  }
}
