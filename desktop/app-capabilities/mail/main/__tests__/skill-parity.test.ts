import { readFile } from "node:fs/promises"
import { expect, it } from "vitest"
import { MAIL_DEFINITIONS, buildMailTools } from "../../shared/capability"
import { MAIL_INPUT_SCHEMAS } from "../../shared/schema"
it("keeps all 44 generated Skill input schemas and permissions aligned with runtime discovery", async () => {
  const source = await readFile(new URL("../../../synapse-skill/skill-package/mail/api-reference.md", import.meta.url), "utf8")
  const definitions = [...source.matchAll(/### (app_mail_[a-z_]+)\n([\s\S]*?)```json\n([\s\S]*?)\n```/gu)]
  expect(definitions).toHaveLength(44)
  for (const tool of buildMailTools()) {
    const entry = definitions.find(match => match[1] === tool.name)
    expect(entry, tool.name).toBeTruthy(); expect(JSON.parse(entry![3])).toEqual(tool.inputSchema)
    const definition = Object.values(MAIL_DEFINITIONS).find(item => item.description === tool.description)!
    expect(entry![2]).toContain(definition.permission)
  }
  expect(buildMailTools().find(tool => tool.name === "app_mail_message_list")?.description).toContain("收件箱")
  expect(source).not.toContain("credential:")
})
it("uses valid minimal inputs in the Agent guide examples", () => {
  const accountId = "ma_e69940c0-4db1-4a0a-8f87-9027d116e194", sourceMessageId = "em_e69940c0-4db1-4a0a-8f87-9027d116e194"
  expect(MAIL_INPUT_SCHEMAS["draft.create"].safeParse({ accountId, sourceMessageId, mode: "reply" }).success).toBe(true)
  expect(MAIL_INPUT_SCHEMAS["draft.create"].safeParse({ accountId, to: [{ address: "recipient@example.com" }], subject: "测试", text: "正文", html: "<p>正文</p>" }).success).toBe(true)
})
