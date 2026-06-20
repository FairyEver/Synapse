import { readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  fakeGitScript,
  launchElectronCdpApp,
  type CdpPage,
} from "./electron-cdp-fixture"

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

    await waitForFile(configPath)
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
