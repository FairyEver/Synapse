import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { GAME_TOOLS } from "@synapse/shared/game-contracts"
const read = (path: string) => readFileSync(new URL(`../../../synapse-skill/skill-package/game-hall/${path}`, import.meta.url), "utf8")
describe("Roll Skill 与真实工具契约", () => {
  it("生成参考的每个参数schema等于运行时注册的30项工具", () => {
    const sections = read("references/api.md").split(/^## /m).slice(1)
    const schemas = new Map(sections.map(section => [section.split("\n")[0], JSON.parse(section.match(/```json\n([\s\S]*?)\n```/)![1])]))
    expect(schemas.size).toBe(GAME_TOOLS.length)
    for(const tool of GAME_TOOLS) expect(schemas.get(tool.name), tool.name).toEqual(tool.inputSchema)
  })
  it("Skill的start与choose示例可以通过真实严格输入schema", () => {
    const examples = [...read("poker/SKILL.md").matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]))
    expect(examples.map(e => e.tool)).toEqual(["app_game_poker_roll_start", "app_game_poker_roll_choose"])
    for(const example of examples) {
      const tool = GAME_TOOLS.find(tool => tool.name === example.tool)!
      expect(z.fromJSONSchema(tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0]).safeParse(example.params).success).toBe(true)
    }
  })
})
