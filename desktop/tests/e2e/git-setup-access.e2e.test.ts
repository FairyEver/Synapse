import { execFile } from "node:child_process"
import { readFile, rm, writeFile, mkdtemp } from "node:fs/promises"
import { existsSync } from "node:fs"
import { promisify } from "node:util"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  fakeGitScript,
  launchElectronCdpApp,
  type CdpPage,
} from "./electron-cdp-fixture"

const execFileAsync = promisify(execFile)

describe("Git setup and access Electron E2E", () => {
  let cleanup: (() => Promise<void>) | null = null

  beforeEach(() => {
    cleanup = null
  })

  afterEach(async () => {
    if (cleanup) await cleanup()
  })

  it("opens the install tab when Git is unavailable in the isolated process", async () => {
    const app = await launchElectronCdpApp({
      fakeGitScript: "#!/bin/sh\necho 'git unavailable in e2e' >&2\nexit 127\n",
    })
    cleanup = app.stop
    const git = await app.openGitWindow()

    await git.waitForText("安装 Git")
    await git.waitForText("未检测到")

    const body = await git.text()
    expect(body).toContain("安装 Git")
    expect(body).not.toContain("sudo apt install")
    if (process.platform === "darwin") {
      expect(body).toContain("Git for macOS")
    }
  }, 60_000)

  it("requires confirmation before writing Git identity to the temporary config", async () => {
    const app = await launchElectronCdpApp({
      fakeGitScript: fakeGitScript({ missingIdentity: true }),
    })
    cleanup = app.stop
    const git = await app.openGitWindow()
    const configPath = path.join(app.paths.home, ".gitconfig")

    await git.clickText("环境")
    await git.waitForText("缺用户名和邮箱")
    await git.fillByLabel("用户名", "Synapse E2E Writer")
    await git.fillByLabel("邮箱", "synapse-e2e@example.com")
    await git.clickText("保存身份")
    await git.waitForText("保存 Git 身份？")
    await git.clickText("取消")

    expect(existsSync(configPath)).toBe(false)

    await git.clickText("保存身份")
    await git.waitForText("保存 Git 身份？")
    await git.clickText("保存")

    await waitForFileContent(configPath, "email = synapse-e2e@example.com")
    const config = await readFile(configPath, "utf8")
    expect(config).toContain("name = Synapse E2E Writer")
    expect(config).toContain("email = synapse-e2e@example.com")
    await git.waitForText("Synapse E2E Writer")
  }, 60_000)

  it("keeps clone auth failures in the dialog before routing to access and saving temporary credentials", async () => {
    const app = await launchElectronCdpApp({
      fakeGitScript: fakeGitScript({
        cloneFailure: "https-auth",
        cloneSucceedsAfterCredential: true,
      }),
    })
    cleanup = app.stop
    const git = await app.openGitWindow()

    await git.clickText("克隆仓库")
    await git.fillByLabel("仓库地址", "https://git.company.com/team/docs.git")
    await git.fillByLabel("保存到", path.join(app.paths.root, "company-docs"))
    expect(await git.valueByLabel("仓库地址")).toBe("https://git.company.com/team/docs.git")
    expect(await git.valueByLabel("保存到")).toBe(path.join(app.paths.root, "company-docs"))
    await git.clickText("开始克隆")

    await git.waitForText("git.company.com 需要登录。")
    expect(await git.text()).toContain("登录访问")
    expect(await git.valueByLabel("仓库地址")).toBe("https://git.company.com/team/docs.git")

    await git.clickText("登录访问")
    await git.waitForText("登录仓库")
    await git.fillByLabel("账号", "synapse-e2e")
    await git.fillByLabel("密码", "synapse-e2e-canary-password")
    await git.clickText("取消")

    await expect(readFile(app.paths.gitLogPath, "utf8")).rejects.toThrow()

    await git.clickText("登录仓库")
    await git.fillByLabel("账号", "synapse-e2e")
    await git.fillByLabel("密码", "synapse-e2e-canary-password")
    await git.clickText("保存")

    await waitForFile(app.paths.gitLogPath)
    const credentialLog = await readFile(app.paths.gitLogPath, "utf8")
    expect(credentialLog).toContain("action=approve")
    expect(credentialLog).toContain("host=git.company.com")
    expect(credentialLog).toContain("username=synapse-e2e")
    expect(credentialLog).toContain("password=synapse-e2e-canary-password")

    await git.waitForText("重试克隆")
    await git.clickText("重试克隆")
    await git.waitForTextGone("重试克隆")
  }, 60_000)

  it("generates an SSH public key in temporary HOME without displaying private key content", async () => {
    const app = await launchElectronCdpApp({
      fakeGitScript: fakeGitScript(),
    })
    cleanup = app.stop
    await installFakeSshKeygen(app.paths.fakeBin)
    const git = await app.openGitWindow()

    await git.clickText("访问")
    await git.waitForText("SSH 公钥")
    await git.clickText("生成 SSH 密钥")
    await git.fillByLabel("邮箱", "synapse-e2e@example.com")
    await git.clickText("生成")

    await git.waitForText("SHA256")
    const publicKey = await readFile(path.join(app.paths.home, ".ssh", "id_ed25519.pub"), "utf8")
    const privateKey = await readFile(path.join(app.paths.home, ".ssh", "id_ed25519"), "utf8")
    const body = await git.text()

    expect(publicKey).toContain("synapse-e2e@example.com")
    expect(privateKey).toContain("PRIVATE KEY SHOULD NOT APPEAR")
    expect(body).not.toContain("PRIVATE KEY SHOULD NOT APPEAR")
    expect(body).toContain("id_ed25519.pub")
  }, 60_000)

  it("opens a temporary repository workbench, reviews a diff, commits, and reads history", async () => {
    const repoRoot = await createTemporaryRepository()
    const app = await launchElectronCdpApp({
      repositoryRegistry: {
        version: 1,
        repositories: [{
          id: "git-workbench-e2e",
          name: "Workbench Repo",
          localPath: repoRoot,
          addedAt: "2026-06-20T00:00:00.000Z",
          lastOpenedAt: null,
        }],
      },
    })
    cleanup = async () => {
      await app.stop()
      await rm(repoRoot, { recursive: true, force: true })
    }
    const git = await app.openGitWindow()

    await git.waitForText("Workbench Repo")
    await git.waitForText("1 个改动")
    await git.clickText("Workbench Repo")
    await git.waitForText("notes.md")
    await git.waitForText("+after")
    await git.fillByLabel("提交说明", "Update notes")
    await git.clickText("提交选中文件")
    await git.waitForText("已提交")
    await git.waitForText("暂无改动")

    const latestSubject = await gitCommand(repoRoot, ["log", "-1", "--pretty=%s"])
    expect(latestSubject.trim()).toBe("Update notes")

    await git.clickText("历史")
    await git.waitForText("Update notes")
    await git.clickText("Update notes")
    await git.waitForText("notes.md")
    await git.waitForText("+after")
  }, 60_000)

  it("pushes, pulls, and syncs temporary repositories from the repository list", async () => {
    const scenario = await createTemporaryRemoteScenario()
    cleanup = async () => {
      await rm(scenario.root, { recursive: true, force: true })
    }
    const app = await launchElectronCdpApp({ repositoryRegistry: scenario.registry })
    cleanup = async () => {
      await app.stop()
      await rm(scenario.root, { recursive: true, force: true })
    }
    const git = await app.openGitWindow()

    await git.waitForText("Remote Push Repo")
    await git.waitForText("推送本地提交")
    await git.clickText("推送本地提交")
    await waitForGitOutput(scenario.root, ["--git-dir", scenario.pushRemote, "log", "--all", "--pretty=%s"], "Local push")

    await git.waitForText("Remote Pull Repo")
    await git.waitForText("拉取远程更新")
    await git.clickText("拉取远程更新")
    await waitForFile(path.join(scenario.pullRepo, "remote.md"))
    const pulled = await readFile(path.join(scenario.pullRepo, "remote.md"), "utf8")
    expect(pulled).toContain("from remote")

    await git.waitForText("Remote Sync Repo")
    await git.clickByAriaLabel("Remote Sync Repo 更多操作")
    await git.clickText("同步")
    await waitForGitOutput(scenario.root, ["--git-dir", scenario.syncRemote, "log", "--all", "--pretty=%s"], "Local sync")
  }, 60_000)
})

async function installFakeSshKeygen(fakeBin: string): Promise<void> {
  const scriptPath = path.join(fakeBin, "ssh-keygen")
  await writeFile(scriptPath, `#!/bin/sh
set -eu
out=""
comment=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -f)
      out="$2"
      shift 2
      ;;
    -C)
      comment="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
mkdir -p "$(dirname "$out")"
printf '%s\\n' 'PRIVATE KEY SHOULD NOT APPEAR' > "$out"
printf '%s\\n' "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGdpdC1lMmUtdGVzdC1rZXktMTIzNDU $comment" > "$out.pub"
`, "utf8")
  await import("node:fs/promises").then(({ chmod }) => chmod(scriptPath, 0o755))
}

async function waitForFile(filePath: string): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 10_000) {
    if (existsSync(filePath)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for file: ${filePath}`)
}

async function waitForFileContent(filePath: string, expectedText: string): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 10_000) {
    if (existsSync(filePath)) {
      const content = await readFile(filePath, "utf8")
      if (content.includes(expectedText)) return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for file content: ${filePath}`)
}

async function createTemporaryRepository(): Promise<string> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-git-workbench-e2e-"))
  await gitCommand(repoRoot, ["init", "-b", "main"])
  await gitCommand(repoRoot, ["config", "user.name", "Synapse E2E"])
  await gitCommand(repoRoot, ["config", "user.email", "synapse-e2e@example.com"])
  await writeFile(path.join(repoRoot, "notes.md"), "before\n", "utf8")
  await gitCommand(repoRoot, ["add", "notes.md"])
  await gitCommand(repoRoot, ["commit", "-m", "Initial notes"])
  await writeFile(path.join(repoRoot, "notes.md"), "before\nafter\n", "utf8")
  return repoRoot
}

async function createTemporaryRemoteScenario(): Promise<{
  readonly pullRepo: string
  readonly pushRemote: string
  readonly registry: Record<string, unknown>
  readonly root: string
  readonly syncRemote: string
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-git-remote-e2e-"))
  const pushRepo = path.join(root, "push-repo")
  const pushRemote = path.join(root, "push.git")
  await initRemoteBackedRepository(pushRepo, pushRemote)
  await writeFile(path.join(pushRepo, "push.md"), "local push\n", "utf8")
  await gitCommand(pushRepo, ["add", "push.md"])
  await gitCommand(pushRepo, ["commit", "-m", "Local push"])

  const pullRepo = path.join(root, "pull-repo")
  const pullRemote = path.join(root, "pull.git")
  await initRemoteBackedRepository(pullRepo, pullRemote)
  const upstreamClone = path.join(root, "upstream-clone")
  await gitCommand(root, ["clone", pullRemote, upstreamClone])
  await gitCommand(upstreamClone, ["config", "user.name", "Synapse E2E"])
  await gitCommand(upstreamClone, ["config", "user.email", "synapse-e2e@example.com"])
  await writeFile(path.join(upstreamClone, "remote.md"), "from remote\n", "utf8")
  await gitCommand(upstreamClone, ["add", "remote.md"])
  await gitCommand(upstreamClone, ["commit", "-m", "Remote pull"])
  await gitCommand(upstreamClone, ["push"])
  await gitCommand(pullRepo, ["fetch", "origin"])

  const syncRepo = path.join(root, "sync-repo")
  const syncRemote = path.join(root, "sync.git")
  await initRemoteBackedRepository(syncRepo, syncRemote)
  await writeFile(path.join(syncRepo, "sync.md"), "local sync\n", "utf8")
  await gitCommand(syncRepo, ["add", "sync.md"])
  await gitCommand(syncRepo, ["commit", "-m", "Local sync"])

  return {
    pullRepo,
    pushRemote,
    root,
    syncRemote,
    registry: {
      version: 1,
      repositories: [
        {
          id: "git-remote-push-e2e",
          name: "Remote Push Repo",
          localPath: pushRepo,
          addedAt: "2026-06-20T00:00:00.000Z",
          lastOpenedAt: null,
        },
        {
          id: "git-remote-pull-e2e",
          name: "Remote Pull Repo",
          localPath: pullRepo,
          addedAt: "2026-06-20T00:00:00.000Z",
          lastOpenedAt: null,
        },
        {
          id: "git-remote-sync-e2e",
          name: "Remote Sync Repo",
          localPath: syncRepo,
          addedAt: "2026-06-20T00:00:00.000Z",
          lastOpenedAt: null,
        },
      ],
    },
  }
}

async function initRemoteBackedRepository(repoRoot: string, remoteRoot: string): Promise<void> {
  await gitCommand(path.dirname(remoteRoot), ["init", "--bare", remoteRoot])
  await gitCommand(path.dirname(remoteRoot), ["--git-dir", remoteRoot, "symbolic-ref", "HEAD", "refs/heads/main"])
  await import("node:fs/promises").then(({ mkdir }) => mkdir(repoRoot, { recursive: true }))
  await gitCommand(repoRoot, ["init", "-b", "main"])
  await gitCommand(repoRoot, ["config", "user.name", "Synapse E2E"])
  await gitCommand(repoRoot, ["config", "user.email", "synapse-e2e@example.com"])
  await writeFile(path.join(repoRoot, "README.md"), "initial\n", "utf8")
  await gitCommand(repoRoot, ["add", "README.md"])
  await gitCommand(repoRoot, ["commit", "-m", "Initial remote"])
  await gitCommand(repoRoot, ["remote", "add", "origin", remoteRoot])
  await gitCommand(repoRoot, ["push", "-u", "origin", "main"])
}

async function waitForGitOutput(cwd: string, args: readonly string[], text: string): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 10_000) {
    const output = await gitCommand(cwd, args)
    if (output.includes(text)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for git output: ${text}`)
}

async function gitCommand(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: path.join(cwd, ".global-gitconfig"),
      HOME: cwd,
    },
  })
  return stdout
}
