import { spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type {
  SynapseContentType,
  SynapseContentWriteResult,
  SynapseCreateRulePayload,
  SynapseCreateSkillPayload,
} from "../../src/types/content"
import {
  contentCreateService,
  getActiveRepositoryWriteContext,
  type ActiveRepositoryWriteContext,
  type WrittenContentArtifact,
} from "./content-create-service"
import { createMainLogger } from "./log-store"
import { createPullRequestProvider } from "./pull-request-provider"

const DEFAULT_TARGET_BRANCH = "main"
const REMOTE_NAME = "origin"
const logger = createMainLogger("service.content-submit")

type GitCommandResult = {
  stderr: string
  stdout: string
}

type SubmissionWorktree = {
  branchName: string
  repositoryWorkPath: string
  targetBranch: string
  worktreePath: string
}

type SubmitContentParams = {
  contentType: SynapseContentType
  createArtifact: (
    context: ActiveRepositoryWriteContext,
    repositoryWorkPath: string,
  ) => Promise<WrittenContentArtifact>
}

function formatBranchTimestamp(date = new Date()): string {
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ]

  return parts.join("")
}

function sanitizeBranchDisplayName(displayName: string): string {
  const trimmedValue = displayName.trim().toLowerCase()

  if (!trimmedValue) {
    return "user"
  }

  const asciiSlug = trimmedValue
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")

  if (asciiSlug) {
    return asciiSlug
  }

  const utf8Hex = Buffer.from(trimmedValue, "utf8").toString("hex").slice(0, 12)

  return utf8Hex ? `user-${utf8Hex}` : "user"
}

function buildBranchName(contentType: SynapseContentType, displayName: string): string {
  return `${contentType}/add/${sanitizeBranchDisplayName(displayName)}/${formatBranchTimestamp()}`
}

function buildCommitMessage(contentType: SynapseContentType, contentId: string): string {
  return `feat(${contentType}): add ${contentId}`
}

function buildPullRequestTitle(contentType: SynapseContentType, contentTitle: string): string {
  const contentLabel = contentType === "rule" ? "rule" : "skill"

  return `Add ${contentLabel}: ${contentTitle}`
}

function buildPullRequestBody(
  artifact: WrittenContentArtifact,
  context: ActiveRepositoryWriteContext,
): string {
  return [
    "Created from Synapse.",
    "",
    `- Type: ${artifact.type}`,
    `- ID: ${artifact.id}`,
    `- Title: ${artifact.title}`,
    `- Author: ${context.author}`,
    `- Git User: ${context.gitUser}`,
  ].join("\n")
}

function toGitPath(filePath: string): string {
  return filePath.split(path.sep).join("/")
}

function formatGitSpawnError(error: unknown): string {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    return "当前系统没有可用的 git 命令，请先安装 Git 并确保命令行可访问。"
  }

  return error instanceof Error ? error.message : "启动 Git 命令失败。"
}

function formatGitFailureMessage(output: string, fallbackMessage: string): string {
  const normalizedOutput = output.trim()
  const firstLine = normalizedOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  const loweredOutput = normalizedOutput.toLowerCase()

  if (
    loweredOutput.includes("authentication failed")
    || loweredOutput.includes("could not read username")
    || loweredOutput.includes("permission denied (publickey)")
    || loweredOutput.includes("permission denied")
    || loweredOutput.includes("fatal: could not read from remote repository")
  ) {
    return "Git 认证失败。请检查系统凭证、SSH Key 或 credential.helper 配置。"
  }

  if (
    loweredOutput.includes("repository not found")
    || loweredOutput.includes("not found")
    || loweredOutput.includes("no such remote")
  ) {
    return "当前仓库没有可用的远程配置，或当前账号没有访问权限。"
  }

  if (
    loweredOutput.includes("could not resolve host")
    || loweredOutput.includes("failed to connect")
    || loweredOutput.includes("connection timed out")
    || loweredOutput.includes("network is unreachable")
    || loweredOutput.includes("connection reset")
  ) {
    return "无法连接到远程仓库。请检查网络连接、代理设置或仓库域名。"
  }

  if (
    loweredOutput.includes("paths are ignored by one of your .gitignore files")
    || loweredOutput.includes("the following paths are ignored")
  ) {
    return "目标内容目录被 .gitignore 忽略了，请先调整仓库规则后再试。"
  }

  if (
    loweredOutput.includes("nothing to commit")
    || loweredOutput.includes("no changes added to commit")
  ) {
    return "当前没有可提交的改动。请检查内容目录是否被 .gitignore 忽略，或仓库里是否已经存在相同内容。"
  }

  if (
    loweredOutput.includes("already exists")
    && loweredOutput.includes("branch")
  ) {
    return "当前提交分支名已存在，请稍后重试。"
  }

  const formattedMessage = firstLine ? `${fallbackMessage}\n${firstLine}` : fallbackMessage

  return formattedMessage
}

function runGitCommand(
  cwd: string,
  args: string[],
  fallbackMessage: string,
): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn("git", args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        LANG: "C",
        LC_ALL: "C",
      },
    })

    let stdout = ""
    let stderr = ""

    childProcess.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })

    childProcess.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })

    childProcess.on("error", (error) => {
      reject(new Error(formatGitSpawnError(error)))
    })

    childProcess.on("close", (code) => {
      if (code === 0) {
        resolve({
          stderr,
          stdout,
        })
        return
      }

      reject(new Error(formatGitFailureMessage(`${stdout}\n${stderr}`, fallbackMessage)))
    })
  })
}

async function resolveOriginRemoteUrl(gitRootPath: string): Promise<string> {
  const result = await runGitCommand(
    gitRootPath,
    ["remote", "get-url", REMOTE_NAME],
    "当前仓库缺少 origin 远程配置，暂时无法创建 PR。",
  )
  const remoteUrl = result.stdout.trim()

  if (!remoteUrl) {
    throw new Error("当前仓库缺少 origin 远程配置，暂时无法创建 PR。")
  }

  return remoteUrl
}

async function resolveTargetBranch(gitRootPath: string): Promise<string> {
  try {
    const result = await runGitCommand(
      gitRootPath,
      ["symbolic-ref", "--short", `refs/remotes/${REMOTE_NAME}/HEAD`],
      "",
    )
    const branchRef = result.stdout.trim()

    if (branchRef.startsWith(`${REMOTE_NAME}/`)) {
      return branchRef.slice(REMOTE_NAME.length + 1)
    }
  } catch (error) {
    logger.warn("Falling back from origin/HEAD branch detection.", { error })
  }

  try {
    const result = await runGitCommand(
      gitRootPath,
      ["ls-remote", "--symref", REMOTE_NAME, "HEAD"],
      "",
    )
    const branchMatch = result.stdout.match(/ref:\s+refs\/heads\/([^\s]+)\s+HEAD/)

    if (branchMatch?.[1]) {
      return branchMatch[1]
    }
  } catch (error) {
    logger.warn("Falling back to the default branch name after remote HEAD lookup failed.", { error })
  }

  return DEFAULT_TARGET_BRANCH
}

async function createSubmissionWorktree(
  context: ActiveRepositoryWriteContext,
  contentType: SynapseContentType,
  targetBranch: string,
): Promise<SubmissionWorktree> {
  const branchName = buildBranchName(contentType, context.author)
  const worktreePath = await mkdtemp(path.join(os.tmpdir(), "synapse-submit-"))
  const repositoryRelativePath = path.relative(context.gitRootPath, context.repository.localPath)
  let worktreeAdded = false
  let branchCreated = false

  if (repositoryRelativePath.startsWith("..") || path.isAbsolute(repositoryRelativePath)) {
    throw new Error("当前目录不在 Git 工作区中，不能继续提交。")
  }

  try {
    await runGitCommand(
      context.gitRootPath,
      ["worktree", "add", "--detach", worktreePath, `${REMOTE_NAME}/${targetBranch}`],
      "创建临时提交工作区失败，请稍后重试。",
    )
    worktreeAdded = true
    await runGitCommand(
      worktreePath,
      ["checkout", "-b", branchName],
      "创建提交分支失败，请稍后重试。",
    )
    branchCreated = true

    return {
      branchName,
      repositoryWorkPath: repositoryRelativePath
        ? path.join(worktreePath, repositoryRelativePath)
        : worktreePath,
      targetBranch,
      worktreePath,
    }
  } catch (error) {
    if (worktreeAdded) {
      try {
        await runGitCommand(
          context.gitRootPath,
          ["worktree", "remove", "--force", worktreePath],
          "",
        )
      } catch (cleanupError) {
        logger.warn("Failed to clean up the temporary worktree after creation failed.", {
          cleanupError,
          worktreePath,
        })
      }
    }

    if (branchCreated) {
      try {
        await runGitCommand(
          context.gitRootPath,
          ["branch", "-D", branchName],
          "",
        )
      } catch (cleanupError) {
        logger.warn("Failed to delete a partial submission branch after setup failed.", {
          branchName,
          cleanupError,
        })
      }
    }

    await rm(worktreePath, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

async function cleanupLocalSubmissionArtifacts(
  gitRootPath: string,
  worktreePath: string,
  branchName: string,
): Promise<void> {
  try {
    await runGitCommand(
      gitRootPath,
      ["worktree", "remove", "--force", worktreePath],
      "",
    )
  } catch (error) {
    logger.warn("Failed to remove temporary worktree.", {
      branchName,
      error,
      worktreePath,
    })
  }

  await rm(worktreePath, { recursive: true, force: true }).catch(() => {})

  try {
    await runGitCommand(
      gitRootPath,
      ["branch", "-D", branchName],
      "",
    )
  } catch (error) {
    logger.warn("Failed to delete local submission branch.", {
      branchName,
      error,
    })
  }
}

async function cleanupRemoteSubmissionBranch(
  gitRootPath: string,
  branchName: string,
): Promise<void> {
  try {
    await runGitCommand(
      gitRootPath,
      ["push", REMOTE_NAME, "--delete", branchName],
      "",
    )
  } catch (error) {
    logger.warn("Failed to delete remote submission branch after PR creation failed.", {
      branchName,
      error,
    })
  }
}

class ContentSubmissionService {
  async createRule(payload: SynapseCreateRulePayload): Promise<SynapseContentWriteResult> {
    return this.submitContent({
      contentType: "rule",
      createArtifact: (context, repositoryWorkPath) => contentCreateService.writeRuleToRepository(
        payload,
        context,
        { baseLocalPath: repositoryWorkPath },
      ),
    })
  }

  async createSkill(payload: SynapseCreateSkillPayload): Promise<SynapseContentWriteResult> {
    return this.submitContent({
      contentType: "skill",
      createArtifact: (context, repositoryWorkPath) => contentCreateService.writeSkillToRepository(
        payload,
        context,
        { baseLocalPath: repositoryWorkPath },
      ),
    })
  }

  private async submitContent(params: SubmitContentParams): Promise<SynapseContentWriteResult> {
    const context = await getActiveRepositoryWriteContext()
    const remoteUrl = await resolveOriginRemoteUrl(context.gitRootPath)
    const pullRequestProvider = createPullRequestProvider(remoteUrl)
    const targetBranch = await resolveTargetBranch(context.gitRootPath)

    await pullRequestProvider.assertReady()
    await runGitCommand(
      context.gitRootPath,
      ["fetch", REMOTE_NAME, targetBranch, "--prune"],
      "无法获取最新主分支，请检查网络、权限或远程配置。",
    )

    const submissionWorktree = await createSubmissionWorktree(context, params.contentType, targetBranch)
    let pushCompleted = false

    try {
      const artifact = await params.createArtifact(context, submissionWorktree.repositoryWorkPath)
      const gitRelativeContentPath = toGitPath(
        path.relative(submissionWorktree.worktreePath, artifact.directoryPath),
      )

      await runGitCommand(
        submissionWorktree.worktreePath,
        ["add", "--", gitRelativeContentPath],
        "暂存新内容失败，请检查仓库状态后重试。",
      )

      await runGitCommand(
        submissionWorktree.worktreePath,
        ["commit", "-m", buildCommitMessage(params.contentType, artifact.id)],
        "创建 Git 提交失败，请检查仓库配置后重试。",
      )

      await runGitCommand(
        submissionWorktree.worktreePath,
        ["push", "--set-upstream", REMOTE_NAME, submissionWorktree.branchName],
        "推送分支失败，请检查网络连接、远程权限或凭证配置。",
      )
      pushCompleted = true

      await pullRequestProvider.createPullRequest({
        baseBranch: submissionWorktree.targetBranch,
        body: buildPullRequestBody(artifact, context),
        headBranch: submissionWorktree.branchName,
        title: buildPullRequestTitle(params.contentType, artifact.title),
      })

      logger.info("Content submission flow completed.", {
        branchName: submissionWorktree.branchName,
        contentId: artifact.id,
        contentType: params.contentType,
        repositoryUuid: context.repository.uuid,
        targetBranch: submissionWorktree.targetBranch,
      })

      return {
        id: artifact.id,
        type: artifact.type,
        title: artifact.title,
        createdAt: artifact.createdAt,
        branchName: submissionWorktree.branchName,
        targetBranch: submissionWorktree.targetBranch,
        message: "提交成功，等待审核。",
      }
    } catch (error) {
      if (pushCompleted) {
        await cleanupRemoteSubmissionBranch(context.gitRootPath, submissionWorktree.branchName)
      }

      logger.error("Content submission flow failed.", {
        contentType: params.contentType,
        error,
        repositoryUuid: context.repository.uuid,
      })
      throw error
    } finally {
      await cleanupLocalSubmissionArtifacts(
        context.gitRootPath,
        submissionWorktree.worktreePath,
        submissionWorktree.branchName,
      )
    }
  }
}

export const contentSubmissionService = new ContentSubmissionService()
