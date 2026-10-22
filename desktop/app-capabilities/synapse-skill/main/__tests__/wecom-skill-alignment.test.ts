import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.join(__dirname, "..", "..", "skill-package", "wecom-mail")

describe("Enterprise WeChat mail Skill alignment", () => {
  it("documents only the three registered mail tools and distinguishes internal mail", async () => {
    const [guide, api] = await Promise.all([
      readFile(path.join(root, "index.md"), "utf8"),
      readFile(path.join(root, "api-reference.md"), "utf8"),
    ])
    const content = `${guide}\n${api}`
    for (const tool of ["app_wecom_mail_list", "app_wecom_mail_get", "app_wecom_mail_send"]) {
      expect(content).toContain(tool)
    }
    expect(content).toContain("站内信")
    expect(content).toContain("WECOM_PERMISSION_REQUIRED")
    expect(content).toContain("helpUrl")
    expect(content).not.toContain("app_wecom_mail_delete")
    expect(content).not.toContain("app_wecom_mail_reply")
  })

  it("forbids credential exposure and requires send confirmation", async () => {
    const guide = await readFile(path.join(root, "index.md"), "utf8")
    expect(guide).toContain("Never ask for, print, log, or persist")
    expect(guide).toContain("confirmed: true")
    expect(guide).toContain("complete preview")
  })
})
