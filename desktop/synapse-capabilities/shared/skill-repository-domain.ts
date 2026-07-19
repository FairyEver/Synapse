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
    id: "app.skill_repository.visibility.update",
    title: "Set skill repository visibility",
    description: "Set a cloud Skill repository to private or public.",
    mutates: true,
  },
  {
    id: "app.skill_repository.item.open",
    title: "Open skill repository",
    description: "Get the management URL for one private cloud Skill repository.",
    mutates: false,
  },
  {
    id: "app.skill_repository.public.open",
    title: "Open public skill repository",
    description: "Get the public URL for a public Skill repository.",
    mutates: false,
  },
  {
    id: "app.skill_repository.fork.create",
    title: "Fork skill repository",
    description: "Fork a readable Skill repository into the signed-in account.",
    mutates: true,
  },
  {
    id: "app.skill_repository.install_session.create",
    title: "Create skill repository install session",
    description: "Create a short-lived Desktop install session for a readable Skill repository.",
    mutates: true,
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
  app_skill_repository_set_visibility: "app.skill_repository.visibility.update",
  app_skill_repository_open: "app.skill_repository.item.open",
  app_skill_repository_open_public: "app.skill_repository.public.open",
  app_skill_repository_fork: "app.skill_repository.fork.create",
  app_skill_repository_create_install_session: "app.skill_repository.install_session.create",
}

const repositoryIdProperty = {
  type: "string",
  description: "Private Skill repository id.",
}

const sourceDirectoryPathProperty = {
  type: "string",
  description: "Exact absolute local Skill directory containing SKILL.md. Whitespace-only input is invalid; non-empty paths are not trimmed. Upload excludes .env, .env.* (except root .env.example), .synapse.json, .synapse.repository.json, other hidden entries, and symlinks without reading excluded runtime env files. The source root must not exceed 1,000 entries. Current and legacy cloud identity files must not exceed 64 KiB.",
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
  description: "Best-effort open of the returned URL when true. The primary operation still succeeds if opening fails; check openWarning and use the returned URL manually.",
}

const visibilityProperty = {
  type: "string",
  enum: ["private", "public"],
  description: "Target Skill repository visibility.",
}

const ownerHandleProperty = {
  type: "string",
  description: "Public owner username used in /skills/<owner>/<repository> URLs.",
}

const repositoryNameProperty = {
  type: "string",
  description: "Public repository name used in /skills/<owner>/<repository> URLs.",
}

const handleRequiredInstruction =
  "If the server returns USER_HANDLE_REQUIRED, ask the user to set their username. Do not set username automatically."
const localAssociationConflictInstruction =
  "If the source directory or .synapse.repository.json changes while the cloud upload is running, Synapse preserves the newer local state, does not recreate a missing directory, and returns identityWritten=false."
const effectiveMutationPermissionInstruction =
  "Cloud mutation permission is checked against the effective repository id resolved from local identity, or new only for a create."

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
      description: `Upload a local Skill as a private cloud Skill repository. A local .synapse.repository.json or legacy .synapse.json identity must be a regular non-symlink file inside the Skill directory; untrusted identity files stop the upload before any cloud update. ${effectiveMutationPermissionInstruction} ${localAssociationConflictInstruction} ${handleRequiredInstruction}`,
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
      description: `Upload a local Skill into an existing private cloud Skill repository. ${effectiveMutationPermissionInstruction} ${localAssociationConflictInstruction} ${handleRequiredInstruction}`,
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
      name: "app_skill_repository_set_visibility",
      description: `Set a cloud Skill repository to private or public. ${handleRequiredInstruction}`,
      inputSchema: {
        type: "object",
        properties: {
          repositoryId: repositoryIdProperty,
          visibility: visibilityProperty,
          openInBrowser: openInBrowserProperty,
        },
        required: ["repositoryId", "visibility"],
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
    {
      name: "app_skill_repository_open_public",
      description: "Get the public URL for a public Skill repository. Provide either repositoryId or ownerHandle plus repositoryName. Opens the browser only when openInBrowser is true.",
      inputSchema: {
        type: "object",
        properties: {
          repositoryId: repositoryIdProperty,
          ownerHandle: ownerHandleProperty,
          repositoryName: repositoryNameProperty,
          openInBrowser: openInBrowserProperty,
        },
        anyOf: [
          { required: ["repositoryId"] },
          { required: ["ownerHandle", "repositoryName"] },
        ],
      },
    },
    {
      name: "app_skill_repository_fork",
      description: `Fork a readable Skill repository into the signed-in account. ${handleRequiredInstruction}`,
      inputSchema: {
        type: "object",
        properties: {
          repositoryId: repositoryIdProperty,
          name: optionalNameProperty,
          title: optionalTitleProperty,
        },
        required: ["repositoryId"],
      },
    },
    {
      name: "app_skill_repository_create_install_session",
      description: "Create a short-lived Desktop install session for a readable Skill repository. Use deepLinkUrl to open Synapse Desktop installation.",
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
