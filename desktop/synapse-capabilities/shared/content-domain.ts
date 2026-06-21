import type { CapabilityId } from "./naming"
import { capabilityIdToMcpTool } from "./naming"
import type {
  CapabilityDefinition,
  CapabilityDomainDefinition,
  McpToolDefinition,
} from "./types"

type ContentResourceType = "rule" | "skill" | "prompt"
const RULE_NAME_PATTERN = "^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$"
const SKILL_NAME_PATTERN = "^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$"
const CONTENT_NAME_MAX_LENGTH = 64
const SKILL_SOURCE_DIRECTORY_LIMITS = "Imports non-hidden attachments up to 100 files, 200 attachment directories, depth 8, 10MB per file, and 50MB total."

const contentCapabilities: readonly CapabilityDefinition[] = [
  { id: "content.type.describe" as CapabilityId, title: "Describe content types", description: "Return content fields, categories, appearance options, and publishing constraints.", mutates: false },
  { id: "content.rule.list" as CapabilityId, title: "List rules", description: "List Synapse Rule resources.", mutates: false },
  { id: "content.rule.get" as CapabilityId, title: "Get rule", description: "Get one Synapse Rule resource by id.", mutates: false },
  { id: "content.rule.create" as CapabilityId, title: "Create rule", description: "Create a Synapse Rule resource.", mutates: true },
  { id: "content.rule.update" as CapabilityId, title: "Update rule", description: "Update a Synapse Rule created by the current repo profile.", mutates: true },
  { id: "content.rule.delete" as CapabilityId, title: "Delete rule", description: "Delete a Synapse Rule created by the current repo profile.", mutates: true },
  { id: "content.skill.list" as CapabilityId, title: "List skills", description: "List Synapse Skill resources.", mutates: false },
  { id: "content.skill.get" as CapabilityId, title: "Get skill", description: "Get one Synapse Skill resource by id.", mutates: false },
  { id: "content.skill.create" as CapabilityId, title: "Create skill", description: "Create a Synapse Skill resource.", mutates: true },
  { id: "content.skill.update" as CapabilityId, title: "Update skill", description: "Update a Synapse Skill created by the current repo profile.", mutates: true },
  { id: "content.skill.delete" as CapabilityId, title: "Delete skill", description: "Delete a Synapse Skill created by the current repo profile.", mutates: true },
  { id: "content.prompt.list" as CapabilityId, title: "List prompts", description: "List Synapse Prompt resources.", mutates: false },
  { id: "content.prompt.get" as CapabilityId, title: "Get prompt", description: "Get one Synapse Prompt resource by id.", mutates: false },
  { id: "content.prompt.create" as CapabilityId, title: "Create prompt", description: "Create a Synapse Prompt resource.", mutates: true },
  { id: "content.prompt.update" as CapabilityId, title: "Update prompt", description: "Update a Synapse Prompt created by the current repo profile.", mutates: true },
  { id: "content.prompt.delete" as CapabilityId, title: "Delete prompt", description: "Delete a Synapse Prompt created by the current repo profile.", mutates: true },
]

export const CONTENT_DOMAIN: CapabilityDomainDefinition = {
  id: "content",
  capabilities: contentCapabilities,
}

export const CONTENT_MCP_TOOL_ACTIONS: Record<string, string> = Object.fromEntries(
  contentCapabilities.map((capability) => [capabilityIdToMcpTool(capability.id), capability.id]),
)

const stringField = (description: string) => ({ type: "string", description })
const contentNameField = (type: Extract<ContentResourceType, "rule" | "skill">) => ({
  type: "string",
  maxLength: CONTENT_NAME_MAX_LENGTH,
  pattern: type === "rule" ? RULE_NAME_PATTERN : SKILL_NAME_PATTERN,
  description: type === "rule"
    ? "Stable Rule name. Use lowercase letters, numbers, hyphens, and dots; max 64 chars; must start/end with a letter or number. Windows reserved names such as con, aux, nul, com1, or lpt1 are rejected, including the segment before a dot."
    : "Stable Skill name. Use lowercase letters, numbers, and hyphens; max 64 chars; must start/end with a letter or number. Do not use dots. Windows reserved names such as con, aux, nul, com1, or lpt1 are rejected.",
})

const iconFields = {
  iconType: {
    type: "string",
    enum: ["icon", "image"],
    description: "Use \"icon\" for built-in icon + background, or \"image\" for a PNG icon generated from iconImagePath/iconImageBase64.",
  },
  icon: stringField("Built-in icon value. Call content_type_describe for allowed values. Required when iconType is icon."),
  iconBg: stringField("Built-in background color value. Call content_type_describe for allowed values. Required when iconType is icon."),
  iconImagePath: stringField("Local image path. Used only when iconType is image. Mutually exclusive with iconImageBase64."),
  iconImageBase64: stringField("Base64 image bytes. Used only when iconType is image. Mutually exclusive with iconImagePath."),
}

const baseCreateProperties = {
  title: stringField("Display title."),
  description: stringField("Short description."),
  category: stringField("Category id. Call content_type_describe for allowed values."),
  content: stringField("Markdown body."),
  usage: stringField("Optional usage guidance."),
  ...iconFields,
}

const skillFileSchema = {
  type: "object",
  properties: {
    path: stringField("Relative path inside the Skill, such as references/checklist.md."),
    contentText: stringField("Text file content. Mutually exclusive with contentBase64."),
    contentBase64: stringField("Base64 file bytes. Mutually exclusive with contentText."),
  },
  required: ["path"],
  allOf: [
    {
      not: {
        required: ["contentText", "contentBase64"],
      },
    },
  ],
}

const skillInlineFields = "name/title/description/category/content"
const inlineRequiredFields = ["title", "description", "category", "content"] as const
const iconImageSourceMutualExclusion = {
  not: {
    required: ["iconImagePath", "iconImageBase64"],
  },
} as const
const skillInputSourceMutualExclusion = {
  not: {
    properties: {
      files: { type: "array", minItems: 1 },
    },
    required: ["files", "sourceDirectoryPath"],
  },
} as const
const appearanceRequirements = [
  {
    properties: {
      iconType: { type: "string", enum: ["icon"] },
    },
    required: ["icon"],
  },
  {
    properties: {
      iconType: { type: "string", enum: ["image"] },
    },
    required: ["iconType", "iconImagePath"],
  },
  {
    properties: {
      iconType: { type: "string", enum: ["image"] },
    },
    required: ["iconType", "iconImageBase64"],
  },
] as const

function withRequiredFields(
  requiredFields: readonly string[],
  requirement: (typeof appearanceRequirements)[number],
): { readonly properties: Record<string, unknown>; readonly required: readonly string[] } {
  return {
    properties: requirement.properties,
    required: [...requiredFields, ...requirement.required],
  }
}

function inlineCreateRequiredFields(type: ContentResourceType): readonly string[] {
  return type === "rule" || type === "skill"
    ? ["name", ...inlineRequiredFields]
    : inlineRequiredFields
}

function createSchemaAlternatives(type: ContentResourceType): readonly unknown[] {
  const inlineFields = inlineCreateRequiredFields(type)
  if (type !== "skill") {
    return appearanceRequirements.map((requirement) => withRequiredFields([], requirement))
  }
  return [
    ...appearanceRequirements.map((requirement) => withRequiredFields(inlineFields, requirement)),
    ...appearanceRequirements.map((requirement) => withRequiredFields(["sourceDirectoryPath"], requirement)),
  ]
}

function schemaConstraints(type: ContentResourceType): readonly unknown[] {
  return type === "skill"
    ? [iconImageSourceMutualExclusion, skillInputSourceMutualExclusion]
    : [iconImageSourceMutualExclusion]
}

function updateSchemaAlternatives(type: ContentResourceType): readonly unknown[] {
  const inlineFields = inlineCreateRequiredFields(type)
  if (type !== "skill") {
    return appearanceRequirements.map((requirement) => withRequiredFields([], requirement))
  }
  return [
    ...appearanceRequirements.map((requirement) => withRequiredFields(inlineFields, requirement)),
    { required: ["sourceDirectoryPath"] },
  ]
}

function listTool(type: ContentResourceType): McpToolDefinition {
  return {
    name: `content_${type}_list`,
    description: `List Synapse ${type} resources. Returns repository and builtin items when available.`,
    inputSchema: {
      type: "object",
      properties: {
        includeDeleted: {
          type: "boolean",
          description: "When true, include deleted repository content.",
        },
      },
    },
  }
}

function getTool(type: ContentResourceType): McpToolDefinition {
  return {
    name: `content_${type}_get`,
    description: `Get one Synapse ${type} resource. Use latestHistoryDirname from this response as baseHistoryDirname for update/delete.`,
    inputSchema: {
      type: "object",
      properties: {
        id: stringField("Content id."),
      },
      required: ["id"],
    },
  }
}

function createTool(type: ContentResourceType): McpToolDefinition {
  const properties: Record<string, unknown> = { ...baseCreateProperties }
  const required: string[] = [...inlineRequiredFields]

  if (type === "rule" || type === "skill") {
    properties.name = contentNameField(type)
    required.unshift("name")
  }

  if (type === "skill") {
    properties.files = {
      type: "array",
      items: skillFileSchema,
      description: "Attachment files. Mutually exclusive with sourceDirectoryPath. Paths are relative to the Skill root and cannot be SKILL.md or .synapse.json.",
    }
    properties.sourceDirectoryPath = stringField(`Local Skill directory to import. Mutually exclusive with files. ${SKILL_SOURCE_DIRECTORY_LIMITS}`)
  }

  return {
    name: `content_${type}_create`,
    description:
      type === "skill"
        ? `Create a Synapse skill. Call content_type_describe first for categories, icons, backgrounds, name rules, and constraints. Use one of two modes: inline with ${skillInlineFields}, or sourceDirectoryPath to import a local Skill directory. files and sourceDirectoryPath are mutually exclusive. ${SKILL_SOURCE_DIRECTORY_LIMITS}`
        : `Create a Synapse ${type}. Call content_type_describe first for categories, icons, backgrounds, name rules, and constraints.`,
    inputSchema: {
      type: "object",
      properties,
      ...(type === "skill" ? {} : { required }),
      anyOf: createSchemaAlternatives(type),
      allOf: schemaConstraints(type),
    },
  }
}

function updateTool(type: ContentResourceType): McpToolDefinition {
  const create = createTool(type)

  return {
    name: `content_${type}_update`,
    description:
      type === "skill"
        ? `Update a Synapse skill created by the current repo profile. First call content_skill_get and pass latestHistoryDirname as baseHistoryDirname. Use one of two modes: inline with ${skillInlineFields}, or sourceDirectoryPath to import a local Skill directory. When sourceDirectoryPath is used and appearance fields are omitted, the current icon/image appearance is preserved. files and sourceDirectoryPath are mutually exclusive. ${SKILL_SOURCE_DIRECTORY_LIMITS} Force update is not supported.`
        : `Update a Synapse ${type} created by the current repo profile. First call content_${type}_get and pass latestHistoryDirname as baseHistoryDirname. Force update is not supported.`,
    inputSchema: {
      type: "object",
      properties: {
        id: stringField("Content id."),
        baseHistoryDirname: stringField("Version token from latestHistoryDirname."),
        ...create.inputSchema.properties,
      },
      required: type === "skill"
        ? ["id", "baseHistoryDirname"]
        : ["id", "baseHistoryDirname", ...(create.inputSchema.required ?? [])],
      anyOf: updateSchemaAlternatives(type),
      allOf: schemaConstraints(type),
    },
  }
}

function deleteTool(type: ContentResourceType): McpToolDefinition {
  return {
    name: `content_${type}_delete`,
    description: `Delete a Synapse ${type} created by the current repo profile. First call content_${type}_get and pass latestHistoryDirname as baseHistoryDirname. Force delete is not supported.`,
    inputSchema: {
      type: "object",
      properties: {
        id: stringField("Content id."),
        baseHistoryDirname: stringField("Version token from latestHistoryDirname."),
      },
      required: ["id", "baseHistoryDirname"],
    },
  }
}

export function buildContentTools(): McpToolDefinition[] {
  return [
    {
      name: "content_type_describe",
      description: "Return content field requirements, categories, icon values, background values, and constraints for Rule, Skill, and Prompt publishing. Call this before create/update.",
      inputSchema: {
        type: "object",
        properties: {
          contentType: {
            type: "string",
            enum: ["rule", "skill", "prompt"],
            description: "Optional content type filter.",
          },
        },
      },
    },
    ...(["rule", "skill", "prompt"] as const).flatMap((type) => [
      listTool(type),
      getTool(type),
      createTool(type),
      updateTool(type),
      deleteTool(type),
    ]),
  ]
}
