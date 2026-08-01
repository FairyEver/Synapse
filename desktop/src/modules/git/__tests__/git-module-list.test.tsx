/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EmbeddedSystemAppShell } from "@/modules/apps/components/embedded-system-app-shell"
import { GitModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const bridge = vi.hoisted(() => ({
  git: {
    checkEnvironment: vi.fn(),
    checkAccess: vi.fn(),
    configureCredentialHelper: vi.fn(),
    saveHttpsCredential: vi.fn(),
    clearHttpsCredential: vi.fn(),
    generateSshKey: vi.fn(),
    testSshConnection: vi.fn(),
    configureIdentity: vi.fn(),
    getSshPublicKey: vi.fn(),
    listRepositories: vi.fn(),
    listRepositorySummaries: vi.fn(),
    addLocalRepository: vi.fn(),
    cloneRepository: vi.fn(),
    removeRepository: vi.fn(),
    getSnapshot: vi.fn(),
    getDiff: vi.fn(),
    commit: vi.fn(),
    listBranches: vi.fn(),
    checkoutBranch: vi.fn(),
    createBranch: vi.fn(),
    listHistory: vi.fn(),
    getCommit: vi.fn(),
    sync: vi.fn(),
    pull: vi.fn(),
    push: vi.fn(),
  },
  settings: {
    repository: {
      chooseDirectory: vi.fn(),
    },
  },
  shell: {
    openExternal: vi.fn(),
  },
}))

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => bridge,
  requireSynapseBridge: () => bridge,
}))

type Repository = {
  readonly id: string
  readonly name: string
  readonly localPath: string
  readonly addedAt: string
  readonly lastOpenedAt: string | null
}

type RepositorySnapshot = {
  readonly repositoryId: string
  readonly pathExists: boolean
  readonly isGitRepository: boolean
  readonly currentBranch: string | null
  readonly upstream: string | null
  readonly ahead: number
  readonly behind: number
  readonly hasConflicts: boolean
  readonly changes: readonly {
    readonly path: string
    readonly originalPath: string | null
    readonly status: "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted" | "unknown"
    readonly staged: boolean
    readonly conflicted: boolean
  }[]
}

function summary(
  repository: Repository,
  snapshot: Partial<RepositorySnapshot> = {},
) {
  return {
    repository,
    snapshot: {
      repositoryId: repository.id,
      pathExists: true,
      isGitRepository: true,
      currentBranch: "main",
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
      hasConflicts: false,
      changes: [],
      ...snapshot,
    },
    error: null,
  }
}

function gitEnvironment(overrides: Record<string, unknown> = {}) {
  return {
    checkedAt: "2026-06-18T10:00:00.000Z",
    platform: "darwin",
    homeDir: "/Users/writer",
    gitAvailable: true,
    gitVersion: "git version 2.50.0",
    gitPath: "/usr/bin/git",
    processPath: "/usr/bin",
    shellPath: "/opt/homebrew/bin:/usr/bin",
    effectivePath: "/usr/bin:/opt/homebrew/bin",
    processGitPath: "/usr/bin/git",
    shellGitPath: "/opt/homebrew/bin/git",
    effectiveGitPath: "/usr/bin/git",
    sshAvailable: true,
    userName: "Writer",
    userEmail: "writer@example.com",
    userNameSource: "file:/Users/writer/.gitconfig",
    userEmailSource: "file:/Users/writer/.gitconfig",
    commonSshKeyExists: true,
    sshPublicKeyPath: "/Users/writer/.ssh/id_ed25519.pub",
    sshPublicKeyType: "ssh-ed25519",
    sshPublicKeyComment: "writer@example.com",
    sshPublicKeyFingerprint: "SHA256:abc",
    installHint: null,
    ...overrides,
  }
}

function gitAccess(overrides: Record<string, unknown> = {}) {
  return {
    checkedAt: "2026-06-18T10:00:00.000Z",
    credentialHelper: {
      helpers: [{ classification: "safe", source: "global", value: "osxkeychain" }],
      management: "synapse-supported",
      helper: "osxkeychain",
      safe: true,
      source: "global",
    },
    hosts: [],
    providerLinks: {
      github: {
        credentialHelpUrl: "https://docs.github.com/en/get-started/git-basics/caching-your-github-credentials-in-git",
        sshKeysUrl: "https://github.com/settings/keys",
        tokenUrl: "https://github.com/settings/tokens",
      },
      gitee: {
        credentialHelpUrl: null,
        sshKeysUrl: "https://gitee.com/profile/sshkeys",
        tokenUrl: null,
      },
      gitlab: {
        credentialHelpUrl: null,
        sshKeysUrl: "https://gitlab.com/-/user_settings/ssh_keys",
        tokenUrl: null,
      },
      generic: {
        credentialHelpUrl: null,
        sshKeysUrl: null,
        tokenUrl: null,
      },
    },
    ssh: {
      available: true,
      publicKeyComment: "writer@example.com",
      publicKeyFingerprint: "SHA256:abc",
      publicKeyPath: "/Users/writer/.ssh/id_ed25519.pub",
      publicKeyType: "ssh-ed25519",
    },
    ...overrides,
  }
}

describe("GitModule repository list", () => {
  const roots: Root[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ""
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
    bridge.git.checkEnvironment.mockResolvedValue(gitEnvironment())
    bridge.git.listRepositories.mockResolvedValue([])
    bridge.git.listRepositorySummaries.mockResolvedValue([])
    bridge.git.checkAccess.mockResolvedValue(gitAccess())
    bridge.git.configureCredentialHelper.mockResolvedValue(undefined)
    bridge.git.saveHttpsCredential.mockResolvedValue(undefined)
    bridge.git.clearHttpsCredential.mockResolvedValue(undefined)
    bridge.git.generateSshKey.mockResolvedValue(undefined)
    bridge.git.testSshConnection.mockResolvedValue({
      detail: "Hi writer! You've successfully authenticated.",
      host: "github.com",
      ok: true,
      title: "SSH 可用",
    })
    bridge.git.getSnapshot.mockResolvedValue({
      repositoryId: "repo-1",
      pathExists: true,
      isGitRepository: true,
      currentBranch: "main",
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
      hasConflicts: false,
      changes: [],
    })
    bridge.git.getDiff.mockResolvedValue({ path: "docs/a.md", originalPath: null, binary: false, text: "" })
    bridge.git.commit.mockResolvedValue({ completedAt: "now", message: "已提交。" })
    bridge.git.listBranches.mockResolvedValue([{ name: "main", current: true }])
    bridge.git.checkoutBranch.mockResolvedValue(undefined)
    bridge.git.createBranch.mockResolvedValue(undefined)
    bridge.git.listHistory.mockResolvedValue([])
    bridge.git.getCommit.mockResolvedValue(null)
    bridge.git.configureIdentity.mockResolvedValue(undefined)
    bridge.git.getSshPublicKey.mockResolvedValue({
      path: "/Users/writer/.ssh/id_ed25519.pub",
      content: "ssh-ed25519 AAAATEST writer@example.com",
    })
    bridge.settings.repository.chooseDirectory.mockResolvedValue(null)
    bridge.shell.openExternal.mockResolvedValue(undefined)
  })

  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await act(async () => root.unmount())
    }
  })

  it("shows only the empty state title when no repositories exist", async () => {
    await renderGitModule(roots)

    expect(document.body.textContent).toContain("暂无仓库")
    expect(countButtons("克隆仓库")).toBeGreaterThan(0)
    expect(countButtons("添加本地仓库")).toBeGreaterThan(0)
  })

  it("uses centered system app tabs and repository actions", async () => {
    await renderGitModule(roots)

    const toolbar = document.querySelector("[data-system-app-window-toolbar]")
    expect(toolbar).toBeTruthy()
    expect(toolbar?.className).toContain("grid-cols-[minmax(0,1fr)_minmax(0,max-content)_minmax(0,1fr)]")
    expect(document.querySelector("[data-system-app-window-left-spacer]")).toBeTruthy()
    expect(document.querySelector("[data-system-app-window-tabs]")?.textContent).toContain("仓库")
    expect(document.querySelector("[data-system-app-window-tabs]")?.textContent).toContain("环境")
    expect(document.querySelector("[data-system-app-window-tabs]")?.textContent).toContain("安装 Git")
    expect(document.querySelector("[data-system-app-window-tabs]")?.textContent).toContain("访问")
    expect(document.querySelector("[data-system-app-window-actions]")?.textContent).toContain("添加本地仓库")
    expect(document.querySelector("[data-system-app-window-actions]")?.textContent).toContain("克隆仓库")
  })

  it("moves Git tabs and repository actions into the embedded system app header", async () => {
    await renderEmbeddedGitModule(roots)

    expect(document.querySelector("[data-system-app-window-toolbar]")).toBeNull()
    expect(document.querySelector("[data-embedded-system-app-tabs]")?.textContent).toContain("仓库")
    expect(document.querySelector("[data-embedded-system-app-tabs]")?.textContent).toContain("环境")
    expect(document.querySelector("[data-embedded-system-app-tabs]")?.textContent).toContain("安装 Git")
    expect(document.querySelector("[data-embedded-system-app-tabs]")?.textContent).toContain("访问")
    expect(document.querySelector("[data-embedded-system-app-actions]")?.textContent).toContain("添加本地仓库")
    expect(document.querySelector("[data-embedded-system-app-actions]")?.textContent).toContain("克隆仓库")
    expect(document.body.textContent).toContain("暂无仓库")
  })

  it("separates Git environment from the repository list tab", async () => {
    await renderGitModule(roots)

    expect(document.body.textContent).toContain("暂无仓库")
    expect(document.body.textContent).not.toContain("Git 环境")

    await click(findButton("环境"))

    expect(document.body.textContent).toContain("Git 环境")
    expect(document.querySelector("[data-system-app-window-actions]")?.textContent).not.toContain("克隆仓库")
  })

  it("switches to install panel when Git is missing and opens the Windows download", async () => {
    bridge.git.checkEnvironment.mockResolvedValue(gitEnvironment({
      platform: "win32",
      gitAvailable: false,
      gitVersion: null,
      gitPath: null,
      processGitPath: null,
      shellGitPath: null,
      effectiveGitPath: null,
      installHint: "运行 winget install Git.Git",
    }))
    await renderGitModule(roots)

    expect(document.body.textContent).toContain("安装 Git")
    expect(document.body.textContent).toContain("未检测到")
    expect(document.body.textContent).toContain("检测系统")
    expect(document.body.textContent).toContain("打开下载页面")
    expect(document.body.textContent).toContain("完成安装")
    expect(document.body.textContent).not.toContain("winget")
    await click(findButton("Git for Windows"))

    expect(bridge.shell.openExternal).toHaveBeenCalledWith("https://git-scm.com/download/win")
  })

  it("shows Linux install boundary with diagnostics copy", async () => {
    bridge.git.checkEnvironment.mockResolvedValue(gitEnvironment({
      platform: "linux",
      gitAvailable: false,
      gitVersion: null,
      gitPath: null,
      processGitPath: null,
      shellGitPath: null,
      effectiveGitPath: null,
      installHint: "sudo apt install git",
    }))
    await renderGitModule(roots)

    expect(document.body.textContent).toContain("当前系统暂不支持图形化引导")
    expect(document.body.textContent).not.toContain("sudo apt install git")
    expect(countButtons("Git for Windows")).toBe(0)

    await click(findButton("复制诊断信息"))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("Git 环境诊断"))
    expect(document.body.textContent).toContain("已复制诊断信息。")
  })

  it("shows credential helper and SSH actions in access tab", async () => {
    await renderGitModule(roots)

    await click(findButton("访问"))

    expect(document.body.textContent).toContain("凭据助手")
    expect(document.body.textContent).toContain("osxkeychain")
    expect(document.body.textContent).toContain("SSH 公钥")
    expect(countButtons("登录仓库")).toBe(0)
    expect(findButton("生成 SSH 密钥")).toBeTruthy()
    expect(findButton("复制公钥")).toBeTruthy()

    await changeInput("主机", "git.company.com")
    expect(findButton("登录仓库")).toBeTruthy()
    await click(findButton("登录仓库"))
    await changeInput("账号", "writer")
    await changeInput("密码", "company-password")
    await click(findButton("保存"))

    expect(bridge.git.saveHttpsCredential).toHaveBeenCalledWith({
      host: "git.company.com",
      password: "company-password",
      port: null,
      protocol: "https",
      username: "writer",
    })

    await click(findButton("复制公钥"))

    expect(bridge.git.getSshPublicKey).toHaveBeenCalled()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("ssh-ed25519 AAAATEST writer@example.com")
    expect(document.body.textContent).toContain("已复制公钥。")
  })

  it("confirms before clearing HTTPS credentials", async () => {
    await renderGitModule(roots)

    await click(findButton("访问"))
    await changeInput("主机", "git.company.com")
    await click(findButton("清除凭据"))

    const dialog = findAlertDialog()
    expect(dialog.textContent).toContain("清除凭据？")
    expect(dialog.textContent).toContain("主机：git.company.com")
    expect(bridge.git.clearHttpsCredential).not.toHaveBeenCalled()

    await click(findAlertDialogButton("清除"))

    expect(bridge.git.clearHttpsCredential).toHaveBeenCalledWith({
      host: "git.company.com",
      port: null,
      protocol: "https",
    })
  })

  it("does not offer credential helper configuration on Linux", async () => {
    bridge.git.checkEnvironment.mockResolvedValue(gitEnvironment({
      platform: "linux",
    }))
    bridge.git.checkAccess.mockResolvedValue(gitAccess({
      credentialHelper: {
        helpers: [],
        management: "unconfigured",
        helper: null,
        safe: false,
        source: null,
      },
    }))
    await renderGitModule(roots)

    await click(findButton("访问"))

    expect(countButtons("配置凭据助手")).toBe(0)
    expect(bridge.git.configureCredentialHelper).not.toHaveBeenCalled()
  })

  it("routes clone auth failure to access and keeps retry context", async () => {
    const error = new Error("需要登录。") as Error & { userFacingFailure: unknown }
    error.userFacingFailure = {
      category: "github-auth",
      detail: "Authentication failed.",
      host: "github.com",
      message: "请处理 GitHub 访问。",
      primaryAction: "handle-github-auth",
      protocol: "https",
      title: "GitHub 访问失败",
    }
    bridge.git.cloneRepository.mockRejectedValue(error)
    bridge.git.checkAccess.mockResolvedValue(gitAccess({
      hosts: [{
        host: "github.com",
        lastFailure: error.userFacingFailure,
        protocol: "https",
        provider: "github",
      }],
    }))
    await renderGitModule(roots)

    await click(findButton("克隆仓库"))
    await changeInput("仓库地址", "https://github.com/acme/docs.git")
    await changeInput("父目录", "/work")
    await click(findButton("开始克隆"))

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("请处理 GitHub 访问。")
    expect(inputByLabel("仓库地址").value).toBe("https://github.com/acme/docs.git")
    expect(findButton("处理 GitHub 访问")).toBeTruthy()

    await click(findButton("处理 GitHub 访问"))

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.body.textContent).toContain("GitHub 访问失败")
    expect(inputByLabel("主机").value).toBe("github.com")
    expect(findButton("重试克隆")).toBeTruthy()
    expect(findButton("浏览器登录")).toBeTruthy()
    expect(findButton("使用访问令牌")).toBeTruthy()
    expect(findButton("改用 SSH")).toBeTruthy()
    await click(findButton("浏览器登录"))
    expect(bridge.shell.openExternal).toHaveBeenCalledWith("https://docs.github.com/en/get-started/git-basics/caching-your-github-credentials-in-git")

    await click(findButton("改用 SSH"))
    expect(bridge.shell.openExternal).toHaveBeenCalledWith("https://github.com/settings/keys")

    await click(findButton("使用访问令牌"))
    expect(document.body.textContent).toContain("访问令牌")
  })

  it("opens credential dialog for generic HTTPS clone auth failures", async () => {
    const error = new Error("需要登录。") as Error & { userFacingFailure: unknown }
    error.userFacingFailure = {
      category: "https-auth",
      detail: "Authentication failed.",
      host: "git.company.com",
      message: "git.company.com 需要登录。",
      primaryAction: "login-host",
      protocol: "https",
      title: "认证失败",
    }
    bridge.git.cloneRepository.mockRejectedValue(error)
    bridge.git.checkAccess.mockResolvedValue(gitAccess({
      hosts: [{
        host: "git.company.com",
        lastFailure: error.userFacingFailure,
        protocol: "https",
        provider: "generic",
      }],
    }))
    await renderGitModule(roots)

    await click(findButton("克隆仓库"))
    await changeInput("仓库地址", "https://git.company.com/team/docs.git")
    await changeInput("父目录", "/work")
    await click(findButton("开始克隆"))

    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain("git.company.com 需要登录。")
    expect(dialog?.textContent).toContain("登录访问")
    expect(inputByLabel("仓库地址").value).toBe("https://git.company.com/team/docs.git")

    await click(findButton("登录访问"))

    const credentialDialog = document.querySelector('[role="dialog"]')
    expect(credentialDialog?.textContent).toContain("登录仓库")
    expect(inputByLabel("主机").value).toBe("git.company.com")
    await changeInput("账号", "writer")
    await changeInput("密码", "company-password")
    await click(findButton("保存"))

    expect(bridge.git.saveHttpsCredential).toHaveBeenCalledWith({
      host: "git.company.com",
      password: "company-password",
      port: null,
      protocol: "https",
      username: "writer",
    })
  })

  it("routes clone identity failures to the environment identity form", async () => {
    const error = new Error("缺少 Git 身份。") as Error & { userFacingFailure: unknown }
    error.userFacingFailure = {
      category: "missing-identity",
      detail: "Author identity unknown.",
      host: null,
      message: "请设置 Git 用户名和邮箱后重试。",
      primaryAction: "set-identity",
      protocol: "unknown",
      title: "缺少 Git 身份",
    }
    bridge.git.checkEnvironment.mockResolvedValue(gitEnvironment({
      userName: null,
      userEmail: null,
      userNameSource: null,
      userEmailSource: null,
    }))
    bridge.git.cloneRepository.mockRejectedValue(error)
    await renderGitModule(roots)

    await click(findButton("克隆仓库"))
    await changeInput("仓库地址", "https://git.company.com/team/docs.git")
    await changeInput("父目录", "/work")
    await click(findButton("开始克隆"))

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("请设置 Git 用户名和邮箱后重试。")
    expect(findButton("配置身份")).toBeTruthy()

    await click(findButton("配置身份"))

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.body.textContent).toContain("Git 身份")
    expect(document.body.textContent).toContain("需要配置 Git 身份")
    expect(findButton("保存身份")).toBeTruthy()
  })

  it("prevents duplicate pending retries", async () => {
    const authError = new Error("需要登录。") as Error & { userFacingFailure: unknown }
    authError.userFacingFailure = {
      category: "github-auth",
      detail: "Authentication failed.",
      host: "github.com",
      message: "请处理 GitHub 访问。",
      primaryAction: "handle-github-auth",
      protocol: "https",
      title: "GitHub 访问失败",
    }
    const retry = deferred<void>()
    bridge.git.cloneRepository
      .mockRejectedValueOnce(authError)
      .mockReturnValueOnce(retry.promise)
    bridge.git.checkAccess.mockResolvedValue(gitAccess({
      hosts: [{
        host: "github.com",
        lastFailure: authError.userFacingFailure,
        protocol: "https",
        provider: "github",
      }],
    }))
    await renderGitModule(roots)

    await click(findButton("克隆仓库"))
    await changeInput("仓库地址", "https://github.com/acme/docs.git")
    await changeInput("父目录", "/work")
    await click(findButton("开始克隆"))
    await click(findButton("处理 GitHub 访问"))

    const retryButton = findButton("重试克隆")
    await click(retryButton)
    await click(retryButton)

    expect(bridge.git.cloneRepository).toHaveBeenCalledTimes(2)
    expect(retryButton.disabled).toBe(true)
    expect(retryButton.textContent).toContain("重试中")

    retry.resolve()
    await act(async () => flush())
  })

  it("clears stale clone retry context when retry fails with a non-access failure", async () => {
    const authError = new Error("需要登录。") as Error & { userFacingFailure: unknown }
    authError.userFacingFailure = {
      category: "github-auth",
      detail: "Authentication failed.",
      host: "github.com",
      message: "请处理 GitHub 访问。",
      primaryAction: "handle-github-auth",
      protocol: "https",
      title: "GitHub 访问失败",
    }
    const pathError = new Error("目标目录已存在。") as Error & { userFacingFailure: unknown }
    pathError.userFacingFailure = {
      category: "path",
      detail: "/work/docs",
      host: null,
      message: "请选择其他目录。",
      primaryAction: "choose-directory",
      protocol: "unknown",
      title: "目录不可用",
    }
    bridge.git.cloneRepository
      .mockRejectedValueOnce(authError)
      .mockRejectedValueOnce(pathError)
    bridge.git.checkAccess.mockResolvedValue(gitAccess({
      hosts: [{
        host: "github.com",
        lastFailure: authError.userFacingFailure,
        protocol: "https",
        provider: "github",
      }],
    }))
    await renderGitModule(roots)

    await click(findButton("克隆仓库"))
    await changeInput("仓库地址", "https://github.com/acme/docs.git")
    await changeInput("父目录", "/work")
    await click(findButton("开始克隆"))
    await click(findButton("处理 GitHub 访问"))
    expect(findButton("重试克隆")).toBeTruthy()

    await click(findButton("重试克隆"))

    expect(document.body.textContent).toContain("目录不可用")
    expect(countButtons("重试克隆")).toBe(0)
    expect(document.body.textContent).not.toContain("github.com重试克隆")

    await click(findButton("访问"))

    expect(document.body.textContent).not.toContain("GitHub 访问失败")
    expect(document.body.textContent).not.toContain("github.com")
    expect(countButtons("重试克隆")).toBe(0)
  })

  it("does not create clone pending access for path failures with parsable remotes", async () => {
    const pathError = new Error("目标目录已存在。") as Error & { userFacingFailure: unknown }
    pathError.userFacingFailure = {
      category: "path",
      detail: "/work/docs",
      host: null,
      message: "请选择其他目录。",
      primaryAction: "choose-directory",
      protocol: "unknown",
      title: "目录不可用",
    }
    bridge.git.cloneRepository.mockRejectedValue(pathError)
    await renderGitModule(roots)

    await click(findButton("克隆仓库"))
    await changeInput("仓库地址", "https://github.com/acme/docs.git")
    await changeInput("父目录", "/work")
    await click(findButton("开始克隆"))

    expect(document.body.textContent).toContain("目录不可用")
    expect(countButtons("重试克隆")).toBe(0)

    await click(findButton("访问"))

    expect(document.body.textContent).not.toContain("github.com")
    expect(countButtons("重试克隆")).toBe(0)
  })

  it("does not show HTTPS credential actions for SSH pending access", async () => {
    const sshError = new Error("SSH 访问失败。") as Error & { userFacingFailure: unknown }
    sshError.userFacingFailure = {
      category: "ssh-auth",
      detail: "Permission denied.",
      host: "github.com",
      message: "请处理 SSH 访问。",
      primaryAction: "handle-ssh",
      protocol: "ssh",
      title: "SSH 访问失败",
    }
    bridge.git.cloneRepository.mockRejectedValue(sshError)
    bridge.git.checkAccess.mockResolvedValue(gitAccess({
      hosts: [{
        host: "github.com",
        lastFailure: sshError.userFacingFailure,
        protocol: "ssh",
        provider: "github",
      }],
    }))
    await renderGitModule(roots)

    await click(findButton("克隆仓库"))
    await changeInput("仓库地址", "git@github.com:acme/docs.git")
    await changeInput("父目录", "/work")
    await click(findButton("开始克隆"))

    await click(findButton("处理 SSH"))

    expect(document.body.textContent).toContain("SSH 访问失败")
    expect(countButtons("登录仓库")).toBe(0)
    expect(countButtons("打开令牌页面")).toBe(0)
    expect(countButtons("清除凭据")).toBe(0)
    expect(findButton("生成 SSH 密钥")).toBeTruthy()
    expect(findButton("复制公钥")).toBeTruthy()
    expect(findButton("打开 SSH 设置")).toBeTruthy()
    expect(findButton("测试 SSH")).toBeTruthy()
  })

  it("routes workbench access failures and clears stale pending after non-access retry", async () => {
    const repository = { id: "repo-1", name: "Docs", localPath: "/work/docs", addedAt: "now", lastOpenedAt: null }
    const authError = new Error("需要登录。") as Error & { userFacingFailure: unknown }
    authError.userFacingFailure = {
      category: "github-auth",
      detail: "Authentication failed.",
      host: "github.com",
      message: "请处理 GitHub 访问。",
      primaryAction: "handle-github-auth",
      protocol: "https",
      title: "GitHub 访问失败",
    }
    const pathError = new Error("目录不可访问。") as Error & { userFacingFailure: unknown }
    pathError.userFacingFailure = {
      category: "path",
      detail: "/work/docs",
      host: null,
      message: "请检查仓库目录。",
      primaryAction: "open-workbench",
      protocol: "unknown",
      title: "目录不可用",
    }
    bridge.git.listRepositorySummaries.mockResolvedValue([
      summary(repository, { behind: 1 }),
    ])
    bridge.git.getSnapshot.mockResolvedValue(summary(repository, { behind: 1 }).snapshot)
    bridge.git.pull
      .mockRejectedValueOnce(authError)
      .mockRejectedValueOnce(pathError)
    bridge.git.checkAccess.mockResolvedValue(gitAccess({
      hosts: [{
        host: "github.com",
        lastFailure: authError.userFacingFailure,
        protocol: "https",
        provider: "github",
      }],
    }))
    await renderGitModule(roots)

    await click(findButton("进入"))
    await click(findButton("拉取远程更新"))

    expect(document.body.textContent).toContain("GitHub 访问失败")
    expect(document.body.textContent).toContain("请处理 GitHub 访问。")

    await click(findButton("处理 GitHub 访问"))

    expect(inputByLabel("主机").value).toBe("github.com")
    expect(findButton("重试拉取")).toBeTruthy()
    expect(findButton("浏览器登录")).toBeTruthy()
    expect(findButton("使用访问令牌")).toBeTruthy()
    expect(findButton("改用 SSH")).toBeTruthy()

    await click(findButton("重试拉取"))
    await click(findButton("访问"))

    expect(document.body.textContent).not.toContain("github.com")
    expect(countButtons("重试拉取")).toBe(0)
  })

  it("renders retry actions for network failures in list and workbench", async () => {
    const repository = { id: "repo-1", name: "Docs", localPath: "/work/docs", addedAt: "now", lastOpenedAt: null }
    const networkError = new Error("网络不可用。") as Error & { userFacingFailure: unknown }
    networkError.userFacingFailure = {
      category: "network",
      detail: "Could not resolve host.",
      host: "github.com",
      message: "请稍后重试。",
      primaryAction: "retry",
      protocol: "https",
      title: "网络不可用",
    }
    bridge.git.listRepositorySummaries.mockResolvedValue([
      summary(repository, { behind: 1 }),
    ])
    bridge.git.getSnapshot.mockResolvedValue(summary(repository, { behind: 1 }).snapshot)
    bridge.git.pull.mockReset()
    bridge.git.pull.mockRejectedValue(networkError)
    await renderGitModule(roots)

    await click(findButton("拉取远程更新"))

    expect(document.body.textContent).toContain("网络不可用")
    expect(countButtons("重试")).toBe(1)

    await click(findButton("进入"))
    await click(findButton("拉取远程更新"))

    expect(document.body.textContent).toContain("网络不可用")
    expect(countButtons("重试")).toBe(1)
  })

  it("shows environment diagnostics and repository issues", async () => {
    bridge.git.listRepositorySummaries.mockResolvedValue([
      summary({ id: "repo-1", name: "Docs", localPath: "/work/docs", addedAt: "now", lastOpenedAt: null }, {
        changes: [{ path: "docs/a.md", originalPath: null, status: "modified", staged: false, conflicted: false }],
      }),
      summary({ id: "repo-2", name: "Missing", localPath: "/work/missing", addedAt: "now", lastOpenedAt: null }, { pathExists: false }),
    ])
    await renderGitModule(roots)

    await click(findButton("环境"))

    expect(document.body.textContent).toContain("git version 2.50.0")
    expect(document.body.textContent).toContain("/usr/bin/git")
    expect(document.body.textContent).toContain("/Users/writer/.gitconfig")
    expect(document.body.textContent).toContain("/Users/writer/.ssh/id_ed25519.pub")
    expect(document.body.textContent).toContain("Docs：1 个改动。")
    expect(document.body.textContent).toContain("Missing：目录不可访问。")
    expect(document.body.textContent).toContain("/work/docs")
    expect(document.querySelector("[data-git-environment-section='Git 运行环境']")?.className).toContain("min-w-0")
    expect(document.querySelector("[data-git-environment-repository-list='true']")).toBeTruthy()
    expect(document.querySelector("table")).toBeNull()
  })

  it("copies visible Git diagnostics", async () => {
    bridge.git.listRepositorySummaries.mockResolvedValue([
      summary({ id: "repo-1", name: "Docs", localPath: "/work/docs", addedAt: "now", lastOpenedAt: null }, { ahead: 1 }),
    ])
    await renderGitModule(roots)

    await click(findButton("环境"))
    await click(findButton("复制诊断信息"))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("Git 环境诊断"))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("writer@example.com"))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("/work/docs"))
    expect(document.body.textContent).toContain("已复制诊断信息。")
  })

  it("opens clone dialog and submits clone request", async () => {
    bridge.git.cloneRepository.mockResolvedValue({
      repository: { id: "repo-1", name: "docs", localPath: "/work/docs", addedAt: "now", lastOpenedAt: null },
      remoteKind: "https",
    })
    await renderGitModule(roots)

    await click(findButton("克隆仓库"))
    await changeInput("仓库地址", "https://git.example.com/team/docs.git")
    await changeInput("父目录", "/work")
    await click(findButton("开始克隆"))

    expect(bridge.git.cloneRepository).toHaveBeenCalledWith(expect.objectContaining({
      remoteUrl: "https://git.example.com/team/docs.git",
      parentDirectory: "/work",
      directoryName: "docs",
    }))
  })

  it("configures missing Git identity after confirmation", async () => {
    bridge.git.checkEnvironment
      .mockResolvedValueOnce(gitEnvironment({
        userName: null,
        userEmail: null,
        commonSshKeyExists: false,
        sshPublicKeyPath: null,
        sshPublicKeyType: null,
        sshPublicKeyComment: null,
        sshPublicKeyFingerprint: null,
      }))
      .mockResolvedValueOnce(gitEnvironment({
        userName: "Writer",
        userEmail: "writer@example.com",
        commonSshKeyExists: false,
        sshPublicKeyPath: null,
        sshPublicKeyType: null,
        sshPublicKeyComment: null,
        sshPublicKeyFingerprint: null,
      }))
    await renderGitModule(roots)

    await click(findButton("环境"))
    await changeInput("用户名", "Writer")
    await changeInput("邮箱", "writer@example.com")
    await click(findButton("保存身份"))
    await click(findButton("保存"))

    expect(bridge.git.configureIdentity).toHaveBeenCalledWith({
      userName: "Writer",
      userEmail: "writer@example.com",
    })
  })

  it("uses native folder selection for clone target path", async () => {
    bridge.settings.repository.chooseDirectory.mockResolvedValue("/work")
    bridge.git.cloneRepository.mockResolvedValue({
      repository: { id: "repo-1", name: "docs", localPath: "/work/docs", addedAt: "now", lastOpenedAt: null },
      remoteKind: "https",
    })
    await renderGitModule(roots)

    await click(findButton("克隆仓库"))
    await changeInput("仓库地址", "https://git.example.com/team/docs.git")
    await click(findButton("选择文件夹"))
    await click(findButton("开始克隆"))

    expect(bridge.settings.repository.chooseDirectory).toHaveBeenCalled()
    expect(bridge.git.cloneRepository).toHaveBeenCalledWith(expect.objectContaining({
      remoteUrl: "https://git.example.com/team/docs.git",
      parentDirectory: "/work",
      directoryName: "docs",
    }))
  })

  it("uses native folder selection and folder name for local repositories", async () => {
    bridge.settings.repository.chooseDirectory.mockResolvedValue("/work/team-rules")
    bridge.git.addLocalRepository.mockResolvedValue({
      id: "repo-1",
      name: "team-rules",
      localPath: "/work/team-rules",
      addedAt: "now",
      lastOpenedAt: null,
    })
    await renderGitModule(roots)

    await click(findButton("添加本地仓库"))
    await click(findButton("选择文件夹"))
    expect(inputByLabel("仓库名称").value).toBe("team-rules")

    await click(findButton("添加"))

    expect(bridge.settings.repository.chooseDirectory).toHaveBeenCalled()
    expect(bridge.git.addLocalRepository).toHaveBeenCalledWith({
      localPath: "/work/team-rules",
      name: "team-rules",
    })
  })

  it("keeps repository sync loading scoped to the clicked repository", async () => {
    const sync = deferred<void>()
    bridge.git.listRepositorySummaries.mockResolvedValue([
      summary({ id: "repo-1", name: "Docs", localPath: "/work/docs", addedAt: "now", lastOpenedAt: null }, { ahead: 1, behind: 1 }),
      summary({ id: "repo-2", name: "App", localPath: "/work/app", addedAt: "now", lastOpenedAt: null }, { ahead: 1, behind: 1 }),
    ])
    bridge.git.sync.mockReturnValue(sync.promise)
    await renderGitModule(roots)

    const syncButtons = exactButtonsByLabel("同步")
    expect(syncButtons).toHaveLength(2)
    expect(countButtons("进入")).toBe(2)

    await click(syncButtons[0])

    expect(bridge.git.sync).toHaveBeenCalledWith("repo-1", expect.any(String))
    expect(syncButtons[0].disabled).toBe(true)
    expect(syncButtons[0].querySelector(".animate-spin")).not.toBeNull()
    expect(syncButtons[1].disabled).toBe(false)
    expect(syncButtons[1].querySelector(".animate-spin")).toBeNull()

    sync.resolve()
    await act(async () => flush())
  })

  it("shows one primary next action for common repository states", async () => {
    bridge.git.listRepositorySummaries.mockResolvedValue([
      summary({ id: "repo-1", name: "Dirty", localPath: "/work/dirty", addedAt: "now", lastOpenedAt: null }, {
        changes: [{ path: "docs/a.md", originalPath: null, status: "modified", staged: false, conflicted: false }],
      }),
      summary({ id: "repo-2", name: "Behind", localPath: "/work/behind", addedAt: "now", lastOpenedAt: null }, { behind: 2 }),
      summary({ id: "repo-3", name: "Ahead", localPath: "/work/ahead", addedAt: "now", lastOpenedAt: null }, { ahead: 1 }),
      summary({ id: "repo-4", name: "Diverged", localPath: "/work/diverged", addedAt: "now", lastOpenedAt: null }, { ahead: 1, behind: 1 }),
      summary({ id: "repo-5", name: "Missing", localPath: "/work/missing", addedAt: "now", lastOpenedAt: null }, { pathExists: false }),
    ])

    await renderGitModule(roots)

    expect(countButtons("提交改动")).toBe(1)
    expect(countButtons("拉取远程更新")).toBe(1)
    expect(countButtons("推送本地提交")).toBe(1)
    expect(exactButtonsByLabel("同步")).toHaveLength(1)
    expect(countButtons("查看状态")).toBe(1)
  })

  it("keeps secondary repository operations in the more menu", async () => {
    bridge.git.listRepositorySummaries.mockResolvedValue([
      summary({ id: "repo-1", name: "Docs", localPath: "/work/docs", addedAt: "now", lastOpenedAt: null }, { ahead: 1 }),
    ])
    await renderGitModule(roots)

    await click(findButtonByName("Docs 更多操作"))

    expect(findMenuItem("拉取")).toBeTruthy()
    expect(findMenuItem("推送")).toBeTruthy()
    expect(findMenuItem("同步")).toBeTruthy()
    expect(findMenuItem("移除仓库")).toBeTruthy()
  })

  it("removes repository records without trashing local files by default", async () => {
    bridge.git.listRepositorySummaries
      .mockResolvedValueOnce([
        summary({ id: "repo-1", name: "Docs", localPath: "/work/docs", addedAt: "now", lastOpenedAt: null }),
      ])
      .mockResolvedValueOnce([])
    bridge.git.removeRepository.mockResolvedValue(undefined)
    await renderGitModule(roots)

    await click(findButtonByName("Docs 更多操作"))
    await click(findMenuItem("移除仓库"))
    const removalDialogText = document.body.textContent ?? ""
    expect(removalDialogText).toContain("移除 Git 仓库？")
    expect(removalDialogText).toContain("只会从 Synapse 列表移除")
    expect(removalDialogText).toContain("目录：/work/docs")
    expect(removalDialogText.indexOf("只会从 Synapse 列表移除")).toBeLessThan(
      removalDialogText.indexOf("目录：/work/docs"),
    )

    await click(findButton("移除"))

    expect(bridge.git.removeRepository).toHaveBeenCalledWith("repo-1")
    expect(bridge.git.listRepositorySummaries).toHaveBeenCalledTimes(2)
  })

  it("does not offer deleting local files", async () => {
    bridge.git.listRepositorySummaries.mockResolvedValue([
      summary({ id: "repo-1", name: "Docs", localPath: "/work/docs", addedAt: "now", lastOpenedAt: null }),
    ])
    await renderGitModule(roots)

    await click(findButtonByName("Docs 更多操作"))
    await click(findMenuItem("移除仓库"))
    expect(document.body.textContent).toContain("/work/docs")
    expect(document.body.textContent).not.toContain("废纸篓")
    expect(bridge.git.removeRepository).not.toHaveBeenCalled()
  })
})

async function renderGitModule(roots: Root[]): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<GitModule />)
    await flush()
  })
}

async function renderEmbeddedGitModule(roots: Root[]): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <EmbeddedSystemAppShell appName="Git" onBack={vi.fn()} onOpenWindow={vi.fn()}>
        <GitModule />
      </EmbeddedSystemAppShell>,
    )
    await flush()
  })
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    const PointerEventCtor = window.PointerEvent ?? window.MouseEvent
    element.dispatchEvent(new PointerEventCtor("pointerdown", { bubbles: true, cancelable: true, button: 0 }))
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }))
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }))
    element.click()
    await flush()
  })
}

async function changeInput(label: string, value: string): Promise<void> {
  const input = inputByLabel(label)
  await act(async () => {
    setNativeInputValue(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await flush()
  })
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await new Promise((resolve) => window.setTimeout(resolve, 0))
}

function findButton(label: string): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll("button"))
  const button = buttons.find((item) => item.textContent === label)
    ?? buttons.find((item) => item.textContent?.includes(label))

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`)
  }

  return button
}

function findButtonByName(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button"))
    .find((item): item is HTMLButtonElement => (
      item instanceof HTMLButtonElement
      && (item.textContent?.includes(label) || item.getAttribute("aria-label") === label)
    ))

  if (!button) {
    throw new Error(`Button not found: ${label}`)
  }

  return button
}

function findMenuItem(label: string): HTMLElement {
  const item = Array.from(document.querySelectorAll('[role="menuitem"]'))
    .find((element) => element.textContent?.includes(label))

  if (!(item instanceof HTMLElement)) {
    throw new Error(`Menu item not found: ${label}`)
  }

  return item
}

function countButtons(label: string): number {
  return buttonsByLabel(label).length
}

function buttonsByLabel(label: string): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll("button"))
    .filter((item): item is HTMLButtonElement => item instanceof HTMLButtonElement && Boolean(item.textContent?.includes(label)))
}

function exactButtonsByLabel(label: string): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll("button"))
    .filter((item): item is HTMLButtonElement => item instanceof HTMLButtonElement && item.textContent === label)
}

function findAlertDialog(): HTMLElement {
  const dialog = document.querySelector('[role="alertdialog"]')
  if (!(dialog instanceof HTMLElement)) {
    throw new Error("Alert dialog not found")
  }
  return dialog
}

function findAlertDialogButton(label: string): HTMLButtonElement {
  const button = Array.from(findAlertDialog().querySelectorAll("button"))
    .find((item): item is HTMLButtonElement => item instanceof HTMLButtonElement && item.textContent?.includes(label))
  if (!button) {
    throw new Error(`Alert dialog button not found: ${label}`)
  }
  return button
}

function inputByLabel(label: string): HTMLInputElement {
  const labelElement = Array.from(document.querySelectorAll("label"))
    .find((item) => item.textContent === label)
  const id = labelElement?.getAttribute("for")
  const input = id ? document.getElementById(id) : null
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Input not found: ${label}`)
  }
  return input
}

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")
  descriptor?.set?.call(input, value)
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}
