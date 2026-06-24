import {
  DOCUMENT_TEMPLATE_CAPABILITY_ID,
  DOCUMENT_TEMPLATE_MCP_TOOL_NAME,
} from "../../app-capabilities/document-template/shared/capability"
import {
  SCREENSHOT_CAPTURE_CAPABILITY_ID,
  SCREENSHOT_CAPTURE_MCP_TOOL_NAME,
  SCREENSHOT_FILE_SAVE_CAPABILITY_ID,
  SCREENSHOT_FILE_SAVE_MCP_TOOL_NAME,
} from "../../app-capabilities/screenshot/shared/capability"
import type { CapabilityDefinition, CapabilityDomainDefinition, McpToolDefinition } from "./types"

const appCapabilities: readonly CapabilityDefinition[] = [
  {
    id: DOCUMENT_TEMPLATE_CAPABILITY_ID,
    title: "Generate Word document from template",
    description: "Generate a local .docx file from a local .docx template and JSON object data.",
    mutates: true,
  },
  {
    id: SCREENSHOT_CAPTURE_CAPABILITY_ID,
    title: "Capture screenshot",
    description: "Capture a fullscreen or coordinate-region PNG screenshot and return a temporary artifact.",
    mutates: false,
  },
  {
    id: SCREENSHOT_FILE_SAVE_CAPABILITY_ID,
    title: "Save screenshot file",
    description: "Capture a fullscreen or coordinate-region PNG screenshot and save it to a local .png file.",
    mutates: true,
  },
]

export const APP_DOMAIN: CapabilityDomainDefinition = {
  id: "app",
  capabilities: appCapabilities,
}

export const APP_MCP_TOOL_ACTIONS: Record<string, string> = {
  [DOCUMENT_TEMPLATE_MCP_TOOL_NAME]: DOCUMENT_TEMPLATE_CAPABILITY_ID,
  [SCREENSHOT_CAPTURE_MCP_TOOL_NAME]: SCREENSHOT_CAPTURE_CAPABILITY_ID,
  [SCREENSHOT_FILE_SAVE_MCP_TOOL_NAME]: SCREENSHOT_FILE_SAVE_CAPABILITY_ID,
}

const stringField = (description: string) => ({ type: "string", description })
const numberField = (description: string) => ({ type: "number", description })

const screenshotRegionSchema = {
  type: "object",
  description: "Screen coordinates for a region capture.",
  properties: {
    x: numberField("Left screen coordinate."),
    y: numberField("Top screen coordinate."),
    width: numberField("Region width in screen coordinates."),
    height: numberField("Region height in screen coordinates."),
  },
  required: ["x", "y", "width", "height"],
} as const

const screenshotCaptureProperties = {
  mode: {
    type: "string",
    enum: ["fullscreen", "region"],
    description: "Use fullscreen for the primary display or region with explicit screen coordinates.",
  },
  region: screenshotRegionSchema,
  hideCurrentWindow: {
    type: "boolean",
    description: "When true, Synapse hides the current focused Synapse window before capture when available.",
  },
} as const

export function buildAppTools(): McpToolDefinition[] {
  return [
    {
      name: DOCUMENT_TEMPLATE_MCP_TOOL_NAME,
      description: "Generate a local .docx file from a .docx template and JSON data. Provide exactly one of dataPath or data. Existing outputPath is rejected unless overwrite is true.",
      inputSchema: {
        type: "object",
        properties: {
          templatePath: stringField("Absolute local .docx template path."),
          outputPath: stringField("Absolute local .docx output path."),
          dataPath: stringField("Absolute local .json data path. Mutually exclusive with data."),
          data: {
            type: "object",
            description: "Inline JSON object data. Mutually exclusive with dataPath.",
          },
          overwrite: {
            type: "boolean",
            description: "When true, replace outputPath if it already exists. Defaults to false.",
          },
        },
        required: ["templatePath", "outputPath"],
        anyOf: [
          { required: ["dataPath"] },
          { required: ["data"] },
        ],
      },
    },
    {
      name: SCREENSHOT_CAPTURE_MCP_TOOL_NAME,
      description: "Capture a fullscreen or coordinate-region PNG screenshot. Fullscreen uses the current focused Synapse window's screen when available, otherwise the primary screen. Region captures require x, y, width, and height screen coordinates. Returns metadata and a temporary PNG path; raw image bytes are not returned through MCP.",
      inputSchema: {
        type: "object",
        properties: screenshotCaptureProperties,
        required: ["mode"],
        allOf: [
          {
            if: { properties: { mode: { const: "region" } } },
            then: { required: ["region"] },
          },
        ],
      },
    },
    {
      name: SCREENSHOT_FILE_SAVE_MCP_TOOL_NAME,
      description: "Capture a fullscreen or coordinate-region PNG screenshot and save it to outputPath. Existing outputPath is rejected unless overwrite is true.",
      inputSchema: {
        type: "object",
        properties: {
          capture: {
            type: "object",
            description: "Screenshot capture input.",
            properties: screenshotCaptureProperties,
            required: ["mode"],
          },
          outputPath: stringField("Absolute local .png output path."),
          overwrite: {
            type: "boolean",
            description: "When true, replace outputPath if it already exists. Defaults to false.",
          },
        },
        required: ["capture", "outputPath"],
      },
    },
  ]
}
