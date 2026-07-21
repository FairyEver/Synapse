import { describe, expect, it } from "vitest"
import {
  APP_DOMAIN,
  APP_MCP_TOOL_ACTIONS,
  buildAppTools,
} from "../../../../synapse-capabilities/shared/app-domain"
import {
  DOCUMENT_TEXT_EXTRACTOR_CAPABILITY_ID,
  DOCUMENT_TEXT_EXTRACTOR_MCP_TOOL_NAME,
} from "../capability"
import { documentTextExtractorCapabilityManifest } from "../manifest"

describe("document text extractor capability", () => {
  it("publishes one read-only format-neutral MCP tool", () => {
    expect(documentTextExtractorCapabilityManifest).toMatchObject({
      id: "document-text-extractor",
      capabilities: [DOCUMENT_TEXT_EXTRACTOR_CAPABILITY_ID],
      mcpTools: [DOCUMENT_TEXT_EXTRACTOR_MCP_TOOL_NAME],
      workflowNodes: [],
    })
    expect(APP_DOMAIN.capabilities).toContainEqual(expect.objectContaining({
      id: DOCUMENT_TEXT_EXTRACTOR_CAPABILITY_ID,
      mutates: false,
    }))
    expect(APP_MCP_TOOL_ACTIONS[DOCUMENT_TEXT_EXTRACTOR_MCP_TOOL_NAME])
      .toBe(DOCUMENT_TEXT_EXTRACTOR_CAPABILITY_ID)
    expect(buildAppTools()).toContainEqual(expect.objectContaining({
      name: DOCUMENT_TEXT_EXTRACTOR_MCP_TOOL_NAME,
      inputSchema: {
        type: "object",
        properties: {
          filePath: expect.objectContaining({ type: "string" }),
        },
        required: ["filePath"],
        additionalProperties: false,
      },
    }))
  })
})
