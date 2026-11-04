import type { CapabilityDomainDefinition, McpToolDefinition } from "../../../synapse-capabilities/shared/types"
import { skillHubActionSchemas, type SkillHubAction } from "./schema"

const catalog = {
  "app.skill_hub.skill.list": ["浏览团队 Skill", "List current team Skills in Snap Skill Hub (团队 Skill 目录、搜索), optionally filtered by team, creator and store text. Pagination: cursor-based. Continue with nextCursor until null; restart after filters or account change.", false],
  "app.skill_hub.skill.get": ["读取团队 Skill", "Read one team Skill from Snap Skill Hub using exactly one skillId or trusted Console detail reference. Returns package name, package description, current version, revision and maintenance permissions; no package bytes.", false],
  "app.skill_hub.team.list": ["查询本人所属团队", "List only my active teams for Snap Skill Hub upload (本人团队、选择上传团队). Use selectionState none/single/multiple across all memberships; only single has defaultTeamId. Pagination: cursor-based. Continue with nextCursor until null; do not infer team count from the current page.", false],
  "app.skill_hub.package.download": ["下载最新版 Skill", "Verify and export the latest team Skill into a new absolute local destinationDirectory. Never overwrites an existing directory. Optional expectedVersionId only checks the current version.", true],
  "app.skill_hub.package.prepare": ["检查并打包本地 Skill", "Check a local Skill directory, Markdown or ZIP for team publication (准备、检查打包). Returns an account/team/caller-bound preparedSourceId, package fields, file manifest, fingerprint and warnings, without ZIP/Base64. No team means no file read; multiple teams require an explicit teamId.", false],
  "app.skill_hub.skill.create": ["上传发布团队 Skill", "Publish a complete prepared Skill to the explicit team (上传、首次发布). Optional displayName/displayDescription/iconPath are store metadata. Use a stable requestId; after a lost result query the original receipt.", true],
  "app.skill_hub.version.create": ["上传完整新版本", "Publish a complete new package for a maintained team Skill (更新 Skill、上传新版), using expectedVersionId from a fresh read and a stable requestId. Identical current content is unchanged. Store metadata is preserved.", true],
  "app.skill_hub.skill.update": ["编辑 Skill 商店资料", "Update only store display name, introduction, or icon from a local image path, with expectedRevision and stable requestId. Omit to keep; iconPath null clears the icon. Package fields and team cannot change here.", true],
  "app.skill_hub.skill.delete": ["软删除团队 Skill", "Soft-delete a specifically identified maintained team Skill using expectedRevision and stable requestId. All package versions remain retained. Ordinary users cannot restore.", true],
  "app.skill_hub.receipt.get": ["查验 Skill Hub 写入回执", "Check a write receipt (查验结果、断线恢复、回执) with the original action and requestId under the original account. A not_found result does not prove failure; never change the key to retry.", false],
} as const satisfies Record<SkillHubAction, readonly [string, string, boolean]>

const actions = Object.keys(catalog) as SkillHubAction[]
const toolName = (action: SkillHubAction) => action.replaceAll(".", "_")

export const SKILL_HUB_DOMAIN: CapabilityDomainDefinition = {
  id: "skill_hub",
  capabilities: actions.map((id) => {
    const [title, description, mutates] = catalog[id]
    return { id, title, description, mutates }
  }),
}

export const SKILL_HUB_MCP_TOOL_ACTIONS = Object.fromEntries(actions.map((action) => [toolName(action), action]))

export function buildSkillHubTools(): McpToolDefinition[] {
  return actions.map((action) => {
    const schema = skillHubActionSchemas[action].toJSONSchema({ io: "input" })
    if (schema.type !== "object" || !schema.properties) throw new Error("Skill Hub discovery requires object input")
    const files = action === "app.skill_hub.package.prepare" || action === "app.skill_hub.skill.create" || action === "app.skill_hub.skill.update"
      ? "; fs.read.outside-userdata when reading local files"
      : action === "app.skill_hub.package.download" ? "; fs.write.outside-userdata" : ""
    return {
      name: toolName(action),
      description: `${catalog[action][1]} Permissions: network.connect${files}; current account only.`,
      inputSchema: {
        type: "object", properties: schema.properties, required: schema.required ?? [], additionalProperties: false,
      },
    }
  })
}
