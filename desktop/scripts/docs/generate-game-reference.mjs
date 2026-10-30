import { writeFile } from "node:fs/promises"
import { GAME_TOOLS } from "@synapse/shared/game-contracts"
const body =
  "# 游戏工具参考\n\n先search原名取得当前schema，再invoke。以下为共享契约生成的参数索引。\n\n" +
  GAME_TOOLS.map(
    (t) =>
      `## ${t.name}\n\n${t.description}\n\n\`\`\`json\n${JSON.stringify(t.inputSchema, null, 2)}\n\`\`\`\n`,
  ).join("\n")
await writeFile(
  new URL(
    "../../app-capabilities/synapse-skill/skill-package/game-hall/references/api.md",
    import.meta.url,
  ),
  body,
)
