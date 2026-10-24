import { expect, it } from "vitest"
import { buildMailTools } from "../capability"
import { MAIL_INPUT_SCHEMAS } from "../schema"

it("exposes alternative inputs as discoverable object properties for clients without top-level combinators", () => {
  const tools = buildMailTools()
  const expected = {
    app_mail_message_get: ["messageId", "reference"],
    app_mail_draft_create: ["accountId", "to", "subject", "sourceMessageId", "mode", "forwardMode"],
    app_mail_attachment_list: ["messageId", "draftId", "cursor", "limit"],
    app_mail_attachment_get: ["assetId", "messageId", "attachmentId"],
    app_mail_attachment_download_file: ["assetId", "messageId", "attachmentId", "outputPath"],
  }
  for (const [name, fields] of Object.entries(expected)) {
    const tool = tools.find(tool => tool.name === name)!
    expect(tool.inputSchema.type).toBe("object")
    for (const combinator of ["anyOf", "oneOf", "allOf"]) expect(tool.inputSchema, name).not.toHaveProperty(combinator)
    for (const field of fields) expect(tool.inputSchema.properties, name).toHaveProperty(field)
    expect(tool.inputSchema.additionalProperties).toBe(false)
  }
  expect(tools.find(tool => tool.name === "app_mail_draft_create")?.inputSchema.required).toEqual(["accountId"])
  expect(tools.find(tool => tool.name === "app_mail_attachment_download_file")?.inputSchema.required).toEqual(["outputPath"])
})
it("still rejects mixed alternative inputs at the runtime boundary", () => {
  const messageId = "em_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  expect(MAIL_INPUT_SCHEMAS["message.get"].safeParse({ messageId }).success).toBe(true)
  expect(MAIL_INPUT_SCHEMAS["message.get"].safeParse({ reference: `synapse://mail/${messageId}` }).success).toBe(true)
  expect(MAIL_INPUT_SCHEMAS["message.get"].safeParse({ messageId, reference: `synapse://mail/${messageId}` }).success).toBe(false)
  expect(MAIL_INPUT_SCHEMAS["attachment.list"].safeParse({ messageId, draftId: "md_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }).success).toBe(false)
})
