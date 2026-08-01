import { describe, expect, it } from "vitest"
import { createGitUserFacingFailure } from "../git-user-facing-failure"

describe("createGitUserFacingFailure", () => {
  it("classifies company HTTPS authentication failures as host login failures", () => {
    const failure = createGitUserFacingFailure("fatal: Authentication failed for https://git.company.com/team/repo.git", {
      fallbackMessage: "Git 操作失败。",
      remoteUrl: "https://git.company.com/team/repo.git",
    })

    expect(failure).toMatchObject({
      category: "https-auth",
      host: "git.company.com",
      message: "git.company.com 需要登录。",
      primaryAction: "login-host",
      protocol: "https",
      title: "认证失败",
    })
  })

  it("preserves HTTP when classifying authentication failures", () => {
    const failure = createGitUserFacingFailure("fatal: Authentication failed for http://git.company.com:8080/team/repo.git", {
      fallbackMessage: "Git 操作失败。",
      remoteUrl: "http://git.company.com:8080/team/repo.git",
    })

    expect(failure).toMatchObject({
      category: "https-auth",
      host: "git.company.com",
      port: 8080,
      primaryAction: "login-host",
      protocol: "http",
    })
  })

  it("classifies GitHub HTTPS authentication failures as GitHub auth", () => {
    const failure = createGitUserFacingFailure("remote: Invalid username or password.\nfatal: Authentication failed for 'https://github.com/team/repo.git/'", {
      fallbackMessage: "Git 操作失败。",
      remoteUrl: "https://github.com/team/repo.git",
    })

    expect(failure).toMatchObject({
      category: "github-auth",
      host: "github.com",
      primaryAction: "handle-github-auth",
      protocol: "https",
      title: "GitHub 需要登录",
    })
  })

  it.each([
    ["401", "fatal: unable to access 'https://github.com/team/repo.git/': The requested URL returned error: 401"],
    ["403", "fatal: unable to access 'https://github.com/team/repo.git/': The requested URL returned error: 403"],
  ] as const)("classifies GitHub HTTPS %s failures as GitHub auth", (_status, output) => {
    const failure = createGitUserFacingFailure(output, {
      fallbackMessage: "Git 操作失败。",
      remoteUrl: "https://github.com/team/repo.git",
    })

    expect(failure).toMatchObject({
      category: "github-auth",
      host: "github.com",
      primaryAction: "handle-github-auth",
      protocol: "https",
      title: "GitHub 需要登录",
    })
  })

  it.each([
    ["401", "fatal: unable to access 'https://git.company.com/team/repo.git/': The requested URL returned error: 401"],
    ["403", "fatal: unable to access 'https://git.company.com/team/repo.git/': The requested URL returned error: 403"],
  ] as const)("classifies generic HTTPS %s failures as host auth", (_status, output) => {
    const failure = createGitUserFacingFailure(output, {
      fallbackMessage: "Git 操作失败。",
      remoteUrl: "https://git.company.com/team/repo.git",
    })

    expect(failure).toMatchObject({
      category: "https-auth",
      host: "git.company.com",
      message: "git.company.com 需要登录。",
      primaryAction: "login-host",
      protocol: "https",
      title: "认证失败",
    })
  })

  it("classifies SSH publickey failures with parsed SSH host", () => {
    const failure = createGitUserFacingFailure("git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.", {
      fallbackMessage: "Git 操作失败。",
      remoteUrl: "git@github.com:team/repo.git",
    })

    expect(failure).toMatchObject({
      category: "ssh-auth",
      host: "github.com",
      primaryAction: "handle-ssh",
      protocol: "ssh",
      title: "SSH 访问失败",
    })
  })

  it("classifies Error diagnostics from stderr and output fields", () => {
    const error = Object.assign(new Error("Git command failed."), {
      output: "",
      stderr: "fatal: could not read Username for 'https://git.company.com': terminal prompts disabled",
      stdout: "",
    })

    const failure = createGitUserFacingFailure(error, {
      fallbackMessage: "Git 操作失败。",
      remoteUrl: "https://git.company.com/team/repo.git",
    })

    expect(failure).toMatchObject({
      category: "https-auth",
      host: "git.company.com",
      primaryAction: "login-host",
    })
  })

  it.each([
    ["git-missing", "current system has no git command", "install-git", "未检测到 Git"],
    ["missing-identity", "Author identity unknown\nPlease tell me who you are.\n  git config --global user.email you@example.com", "set-identity", "缺少 Git 身份"],
    ["network", "fatal: unable to access 'https://git.example.com/team/repo.git/': Could not resolve host: git.example.com", "retry", "网络连接失败"],
    ["timeout", "Command failed after 60000ms: timeout", "retry", "操作超时"],
    ["repository-not-found", "remote: Repository not found.\nfatal: repository 'https://github.com/team/repo.git/' not found", "login-host", "仓库不存在或无权限"],
    ["not-git-repository", "fatal: not a git repository (or any of the parent directories): .git", "open-workbench", "不是 Git 仓库"],
    ["dirty", "error: Your local changes to the following files would be overwritten by checkout", "open-workbench", "本地有未提交改动"],
    ["non-fast-forward", "! [rejected] main -> main (non-fast-forward)", "open-workbench", "需要先拉取远程更新"],
    ["conflict", "CONFLICT (content): Merge conflict in README.md", "open-workbench", "需要处理冲突"],
    ["path", "fatal: cannot change to '/missing/repo': No such file or directory", "choose-directory", "本地路径不可用"],
    ["unknown", "fatal: unexpected git failure code 99", "copy-diagnostics", "Git 操作失败"],
  ] as const)("classifies %s failures", (category, output, primaryAction, title) => {
    const failure = createGitUserFacingFailure(output, { fallbackMessage: "Git 操作失败。" })

    expect(failure).toMatchObject({
      category,
      primaryAction,
      title,
    })
  })

  it("redacts secrets from JSON output while preserving ordinary paths", () => {
    const failure = createGitUserFacingFailure(
      "fatal: Authentication failed for https://token:ghp_secret123456@github.com/team/repo.git?token=raw-token\ncwd: /Users/writer/work/repo",
      {
        fallbackMessage: "Git 操作失败。",
        remoteUrl: "https://token:ghp_secret123456@github.com/team/repo.git?token=raw-token",
      },
    )

    const serialized = JSON.stringify(failure)
    expect(serialized).not.toContain("ghp_secret")
    expect(serialized).not.toContain("raw-token")
    expect(failure.detail).toContain("/Users/writer/work/repo")
    expect(failure.detail).toContain("https://[redacted]@github.com/team/repo.git")
  })

  it("redacts Authorization Basic and Bearer payloads from detail", () => {
    const failure = createGitUserFacingFailure(
      "Authorization: Basic dXNlcjpzZWNyZXQ=\nAuthorization: Bearer raw.bearer.payload\ncwd: /Users/writer/work/repo",
      {
        fallbackMessage: "Git 操作失败。",
        remoteUrl: "https://git.company.com/team/repo.git",
      },
    )

    const serialized = JSON.stringify(failure)
    expect(serialized).not.toContain("dXNlcjpzZWNyZXQ")
    expect(serialized).not.toContain("raw.bearer.payload")
    expect(failure.detail).toContain("Authorization: Basic [redacted]")
    expect(failure.detail).toContain("Authorization: Bearer [redacted]")
    expect(failure.detail).toContain("/Users/writer/work/repo")
  })
})
