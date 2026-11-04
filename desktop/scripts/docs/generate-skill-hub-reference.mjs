import { build } from "esbuild"
import { writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const desktop = fileURLToPath(new URL("../..", import.meta.url))
const bundle = await build({
  stdin: { contents: 'export { buildSkillHubTools } from "./app-capabilities/skill-hub/shared/capability"', resolveDir: desktop },
  bundle: true, platform: "node", format: "esm", write: false,
})
const { buildSkillHubTools } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`)
const tools = buildSkillHubTools()
const header = "# Skill Hub MCP API 参考\n\n"
  + "由 `node desktop/scripts/docs/generate-skill-hub-reference.mjs` 从工具输入定义生成。公开入口只有 search 和 invoke。操作流程与返回值见 [Skill Hub 指南](index.md)。\n"
const sections = tools.map((tool) => `## ${tool.name}\n\n${tool.description}\n\n\`\`\`json\n${JSON.stringify(tool.inputSchema, null, 2)}\n\`\`\`\n`)
await writeFile(new URL("../../app-capabilities/synapse-skill/skill-package/skill-hub/api-reference.md", import.meta.url), [header, ...sections].join("\n"))
process.stdout.write(`Generated ${tools.length} Skill Hub input definitions.\n`)
