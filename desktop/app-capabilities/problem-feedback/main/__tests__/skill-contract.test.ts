import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

const skillRoot = path.join(
  process.cwd(),
  "app-capabilities",
  "synapse-skill",
  "skill-package",
)

describe("problem feedback Skill contract", () => {
  it("routes from the root and keeps the complete behavior in the App guide", async () => {
    const [root, appGuide, apiReference] = await Promise.all([
      readFile(path.join(skillRoot, "SKILL.md"), "utf8"),
      readFile(path.join(skillRoot, "app/index.md"), "utf8"),
      readFile(path.join(skillRoot, "app/api-reference.md"), "utf8"),
    ])

    expect(root).toContain("read `app/index.md` before suggesting problem feedback")
    expect(root).toContain("Do not suggest feedback for ordinary validation")
    expect(appGuide).toContain("用户主动触发时，只提示发现的归因疑点，不能代替用户否决")
    expect(appGuide).toContain("展示确认稿前完成语义隐私审查和脱敏")
    expect(appGuide).toContain("不得在同一回合调用工具")
    expect(appGuide).toContain("只处理紧接的下一条用户消息")
    expect(appGuide).toContain("一次确认只授权一次工具调用")
    expect(appGuide).toContain("禁止 curl、浏览器、自行拼 HTTP")
    expect(appGuide).toContain("可能已提交及重复风险")
    expect(apiReference).toContain("app_problem_feedback_report_submit")
    expect(apiReference).toContain("The true maximum is 256 KiB")
    expect(apiReference).toContain("Never retry automatically")
  })
})
