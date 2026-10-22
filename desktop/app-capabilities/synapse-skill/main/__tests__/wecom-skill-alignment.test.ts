import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.join(__dirname, "..", "..", "skill-package", "wecom")
const upstreamCommit = "55785fa0a5c922279533a5b5a836b44b56f65ce7"
const supportedSkills = [
  "wecomcli-contact",
  "wecomcli-doc-manage",
  "wecomcli-email",
  "wecomcli-media",
  "wecomcli-message",
  "wecomcli-shared",
  "wecomcli-sheet",
  "wecomcli-smartsheet",
]
const excludedSkills = [
  "wecomcli-disk",
  "wecomcli-todo",
  "wecomcli-meeting",
  "wecomcli-calendar",
  "wecomcli-pptx",
  "wecomcli-smartpage",
  "wecomcli-doc",
]

async function readMarkdown(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const contents = await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) return readMarkdown(file)
    return entry.name.endsWith(".md") ? [await readFile(file, "utf8")] : []
  }))
  return contents.flat()
}

describe("Enterprise WeChat official Skills", () => {
  it("ships only the eight supported official Skills on every upstream update", async () => {
    const entries = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("wecomcli-"))
      .map((entry) => entry.name)
      .sort()

    expect(entries).toEqual(supportedSkills)
    await Promise.all(entries.map(async (name) => {
      const content = await readFile(path.join(root, name, "SKILL.md"), "utf8")
      expect(content, name).toMatch(/^---\nname: wecomcli-/u)
      if (name !== "wecomcli-shared") {
        expect(content, name).toContain("app_wecom_cli_run")
        expect(content, name).not.toMatch(/\nrequires:\n/u)
        expect(content, name).not.toContain('bins: ["wecom-cli"]')
        expect(content, name).not.toContain("cliHelp:")
      }
    }))
  })

  it("uses Synapse connection and execution instead of CLI setup or login", async () => {
    const shared = await readFile(path.join(root, "wecomcli-shared", "SKILL.md"), "utf8")

    expect(shared).toContain("app_wecom_connection_get")
    expect(shared).toContain("app_wecom_cli_run")
    expect(shared).toContain("不要安装或升级 CLI")
    expect(shared).toContain("不得在终端或 Bash 中直接运行")
    expect(shared).not.toContain("npm install -g @wecom/cli")
    expect(shared).not.toContain("wecom-cli auth init")
    expect(shared).not.toContain("wecom-cli auth show")
  })

  it("records the upstream commit and license", async () => {
    const [upstream, license] = await Promise.all([
      readFile(path.join(root, "UPSTREAM.md"), "utf8"),
      readFile(path.join(root, "LICENSE"), "utf8"),
    ])

    expect(upstream).toContain(upstreamCommit)
    expect(upstream).toContain("8 Skills")
    for (const name of excludedSkills) expect(upstream).toContain(name)
    expect(license).toContain("MIT License")
    expect(license).toContain("Copyright (c) 2026 WeCom")
  })

  it("keeps supported official references", async () => {
    const email = await readFile(path.join(root, "wecomcli-email", "references", "send-mail.md"), "utf8")

    expect(email).toContain("wecom-cli mail send")
  })

  it("never routes supported Skills to excluded Skills", async () => {
    const contents = [
      await readFile(path.join(root, "..", "SKILL.md"), "utf8"),
      ...(await Promise.all(supportedSkills.map((name) => readMarkdown(path.join(root, name))))).flat(),
    ]
    for (const content of contents) {
      for (const name of excludedSkills) {
        expect(content).not.toMatch(new RegExp(`${name}(?![a-z-])`, "u"))
      }
    }
  })
})
