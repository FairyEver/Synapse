import { spawn } from "node:child_process"
import { createMainLogger } from "./log-store"

const logger = createMainLogger("service.pull-request")

type PullRequestProviderInput = {
  baseBranch: string
  body: string
  headBranch: string
  title: string
}

type PullRequestProviderResult = {
  number: number | null
  url: string | null
}

type PullRequestProvider = {
  assertReady: () => Promise<void>
  createPullRequest: (input: PullRequestProviderInput) => Promise<PullRequestProviderResult>
}

type GitHubRepositoryRef = {
  owner: string
  repo: string
}

function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn(command, args, {
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

    childProcess.on("error", reject)

    childProcess.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim())
        return
      }

      const message = stderr.trim() || stdout.trim()
      reject(new Error(message || `${command} 命令执行失败。`))
    })
  })
}

function parseGitHubRemote(remoteUrl: string): GitHubRepositoryRef | null {
  const sshMatch = remoteUrl.match(/^git@github\.com:(.+?)\/(.+?)(?:\.git)?$/)

  if (sshMatch) {
    return {
      owner: sshMatch[1],
      repo: sshMatch[2],
    }
  }

  try {
    const parsedUrl = new URL(remoteUrl)

    if (parsedUrl.hostname !== "github.com") {
      return null
    }

    const pathSegments = parsedUrl.pathname
      .replace(/^\/+/, "")
      .replace(/\.git$/, "")
      .split("/")
      .filter(Boolean)

    if (pathSegments.length !== 2) {
      return null
    }

    return {
      owner: pathSegments[0],
      repo: pathSegments[1],
    }
  } catch {
    return null
  }
}

async function resolveGitHubToken(): Promise<string> {
  const envToken = process.env.GH_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim()

  if (envToken) {
    return envToken
  }

  try {
    const token = await runCommand("gh", ["auth", "token"])

    if (token) {
      return token
    }
  } catch (error) {
    logger.warn("GitHub CLI token is unavailable for PR creation.", { error })
  }

  throw new Error(
    "创建 GitHub PR 需要可用的认证。请先设置 GH_TOKEN / GITHUB_TOKEN，或在终端执行 gh auth login。",
  )
}

function formatGitHubApiError(status: number, responseBody: unknown): string {
  const message = (
    typeof responseBody === "object"
    && responseBody !== null
    && "message" in responseBody
    && typeof responseBody.message === "string"
  )
    ? responseBody.message
    : null
  const loweredMessage = message?.toLowerCase() ?? ""

  if (status === 401 || status === 403) {
    return "GitHub 认证失败。请先确认当前账号具备创建 PR 的权限。"
  }

  if (status === 404) {
    return "找不到对应的 GitHub 仓库，或当前账号没有访问权限。"
  }

  if (status === 422 && loweredMessage.includes("pull request already exists")) {
    return "当前分支已经创建过 PR，请先到 GitHub 检查现有 PR。"
  }

  const fallbackMessage = "调用 GitHub 创建 PR 失败，请稍后重试。"

  return message ? `${fallbackMessage}\n${message}` : fallbackMessage
}

class GitHubPullRequestProvider implements PullRequestProvider {
  constructor(private readonly repository: GitHubRepositoryRef) {}

  async assertReady(): Promise<void> {
    await resolveGitHubToken()
  }

  async createPullRequest(input: PullRequestProviderInput): Promise<PullRequestProviderResult> {
    const token = await resolveGitHubToken()

    let response: Response

    try {
      response = await fetch(
        `https://api.github.com/repos/${this.repository.owner}/${this.repository.repo}/pulls`,
        {
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "User-Agent": "Synapse",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({
            title: input.title,
            head: input.headBranch,
            base: input.baseBranch,
            body: input.body,
          }),
        },
      )
    } catch (error) {
      logger.error("GitHub PR request failed before receiving a response.", { error })
      throw new Error("连接 GitHub 失败，请检查网络连接或代理设置后重试。")
    }

    const responseBody = await response.json().catch(() => null)

    if (!response.ok) {
      throw new Error(formatGitHubApiError(response.status, responseBody))
    }

    const pullRequestNumber = (
      typeof responseBody === "object"
      && responseBody !== null
      && "number" in responseBody
      && typeof responseBody.number === "number"
    )
      ? responseBody.number
      : null
    const pullRequestUrl = (
      typeof responseBody === "object"
      && responseBody !== null
      && "html_url" in responseBody
      && typeof responseBody.html_url === "string"
    )
      ? responseBody.html_url
      : null

    return {
      number: pullRequestNumber,
      url: pullRequestUrl,
    }
  }
}

function createPullRequestProvider(remoteUrl: string): PullRequestProvider {
  const githubRepository = parseGitHubRemote(remoteUrl)

  if (githubRepository) {
    return new GitHubPullRequestProvider(githubRepository)
  }

  throw new Error("当前只支持为 GitHub 仓库自动创建 PR。")
}

export {
  createPullRequestProvider,
  type PullRequestProvider,
  type PullRequestProviderInput,
  type PullRequestProviderResult,
}
