import { describe, expect, it } from "vitest"
import {
  APP_DOMAIN,
  APP_MCP_TOOL_ACTIONS,
  buildAppTools,
} from "../../../../synapse-capabilities/shared/app-domain"
import {
  TEXT_EXTRACTOR_CAPABILITY_ID,
  TEXT_EXTRACTOR_MCP_TOOL_NAME,
  TEXT_EXTRACT_WORKFLOW_NODE_TYPE,
} from "../capability"
import { textExtractorCapabilityManifest } from "../manifest"
import { textExtractionResultSchema } from "../schema"

describe("text extractor capability", () => {
  it("publishes one read-only format-neutral MCP tool", () => {
    expect(textExtractorCapabilityManifest).toMatchObject({
      id: "text-extractor",
      capabilities: [TEXT_EXTRACTOR_CAPABILITY_ID],
      mcpTools: [TEXT_EXTRACTOR_MCP_TOOL_NAME],
      workflowNodes: [TEXT_EXTRACT_WORKFLOW_NODE_TYPE],
    })
    expect(APP_DOMAIN.capabilities).toContainEqual(expect.objectContaining({
      id: TEXT_EXTRACTOR_CAPABILITY_ID,
      description: expect.stringMatching(/PDF.*DOCX/i),
      mutates: false,
    }))
    expect(APP_MCP_TOOL_ACTIONS[TEXT_EXTRACTOR_MCP_TOOL_NAME])
      .toBe(TEXT_EXTRACTOR_CAPABILITY_ID)
    expect(buildAppTools()).toContainEqual(expect.objectContaining({
      name: TEXT_EXTRACTOR_MCP_TOOL_NAME,
      description: expect.stringMatching(/PDF.*DOCX/i),
      inputSchema: {
        type: "object",
        properties: {
          filePath: expect.objectContaining({
            type: "string",
            description: expect.stringMatching(/\.pdf.*\.docx/i),
          }),
        },
        required: ["filePath"],
        additionalProperties: false,
      },
    }))
  })

  it("keeps PDF pages optional metadata out of DOCX results", () => {
    expect(textExtractionResultSchema.safeParse({
      text: "text",
      format: "docx",
      fileName: "document.docx",
      size: 42,
      pages: 1,
    }).success).toBe(false)
  })
})
