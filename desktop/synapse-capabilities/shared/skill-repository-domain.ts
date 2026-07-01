import type { CapabilityId } from "./naming"
import type { CapabilityDefinition, CapabilityDomainDefinition, McpToolDefinition } from "./types"

const skillRepositoryCapabilities = [
  {
    id: "app.skill_repository.item.list",
    title: "List skill repositories",
    description: "List private cloud Skill repositories for the signed-in account.",
    mutates: false,
  },
  {
    id: "app.skill_repository.item.get",
    title: "Get skill repository",
    description: "Get one private cloud Skill repository.",
    mutates: false,
  },
  {
    id: "app.skill_repository.item.import_local",
    title: "Import local skill repository",
    description: "Upload a local Skill as a private cloud Skill repository.",
    mutates: true,
  },
  {
    id: "app.skill_repository.item.update_local",
    title: "Update local skill repository",
    description: "Upload a local Skill into an existing private cloud Skill repository.",
    mutates: true,
  },
  {
    id: "app.skill_repository.item.open",
    title: "Open skill repository",
    description: "Get the management URL for one private cloud Skill repository.",
    mutates: false,
  },
] satisfies readonly CapabilityDefinition[]

export const SKILL_REPOSITORY_DOMAIN: CapabilityDomainDefinition = {
  id: "skill_repository",
  capabilities: skillRepositoryCapabilities,
}

export const SKILL_REPOSITORY_MCP_TOOL_ACTIONS: Record<string, CapabilityId> = {
  app_skill_repository_list: "app.skill_repository.item.list",
  app_skill_repository_get: "app.skill_repository.item.get",
  app_skill_repository_import_local: "app.skill_repository.item.import_local",
  app_skill_repository_update_local: "app.skill_repository.item.update_local",
  app_skill_repository_open: "app.skill_repository.item.open",
}

const repositoryIdProperty = {
  type: "string",
  description: "Private Skill repository id.",
}

const sourceDirectoryPathProperty = {
  type: "string",
  description: "Absolute local Skill directory path containing SKILL.md.",
}

const optionalNameProperty = {
  type: "string",
  description: "Optional repository name. Defaults to Skill metadata or local directory name.",
}

const optionalTitleProperty = {
  type: "string",
  description: "Optional title. Defaults to Skill metadata.",
}

const optionalDescriptionProperty = {
  type: "string",
  description: "Optional description. Defaults to Skill metadata.",
}

const openInBrowserProperty = {
  type: "boolean",
  description: "Open the management URL in the browser only when true.",
}

const handleRequiredInstruction =
  "If the server returns USER_HANDLE_REQUIRED, ask the user to set their username. Do not set username automatically."

export function buildSkillRepositoryTools(): McpToolDefinition[] {
  return [
    {
      name: "app_skill_repository_list",
      description: "List private cloud Skill repositories for the signed-in account.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "app_skill_repository_get",
      description: "Get one private cloud Skill repository by id.",
      inputSchema: {
        type: "object",
        properties: {
          repositoryId: repositoryIdProperty,
        },
        required: ["repositoryId"],
      },
    },
    {
      name: "app_skill_repository_import_local",
      description: `Upload a local Skill as a private cloud Skill repository. ${handleRequiredInstruction}`,
      inputSchema: {
        type: "object",
        properties: {
          sourceDirectoryPath: sourceDirectoryPathProperty,
          name: optionalNameProperty,
          title: optionalTitleProperty,
          description: optionalDescriptionProperty,
          openInBrowser: openInBrowserProperty,
        },
        required: ["sourceDirectoryPath"],
      },
    },
    {
      name: "app_skill_repository_update_local",
      description: `Upload a local Skill into an existing private cloud Skill repository. ${handleRequiredInstruction}`,
      inputSchema: {
        type: "object",
        properties: {
          sourceDirectoryPath: sourceDirectoryPathProperty,
          repositoryId: repositoryIdProperty,
          name: optionalNameProperty,
          title: optionalTitleProperty,
          description: optionalDescriptionProperty,
          openInBrowser: openInBrowserProperty,
        },
        required: ["sourceDirectoryPath", "repositoryId"],
      },
    },
    {
      name: "app_skill_repository_open",
      description: "Get the management URL for one private cloud Skill repository. Opens the browser only when openInBrowser is true.",
      inputSchema: {
        type: "object",
        properties: {
          repositoryId: repositoryIdProperty,
          openInBrowser: openInBrowserProperty,
        },
        required: ["repositoryId"],
      },
    },
  ]
}
