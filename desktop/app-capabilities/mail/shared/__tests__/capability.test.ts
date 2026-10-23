import { expect, it } from "vitest"
import { buildMailTools } from "../capability"

it("retains an object MCP envelope around strict alternative input branches", () => {
  const tool = buildMailTools().find(tool => tool.name === "app_mail_message_get")!
  expect(tool.inputSchema.type).toBe("object")
  expect(tool.inputSchema).toHaveProperty("anyOf")
})
