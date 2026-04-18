import type { SynapseContentType } from "@/types/content"
import type { SynapseCategoryDefinition } from "@/types/category"
import { rulesCategories } from "@/config/categories/rules"
import { skillsCategories } from "@/config/categories/skills"

const categoryRegistry = {
  rule: rulesCategories,
  skill: skillsCategories,
} as const satisfies Record<SynapseContentType, readonly SynapseCategoryDefinition[]>

function getBuiltInCategories(contentType: SynapseContentType): readonly SynapseCategoryDefinition[] {
  return categoryRegistry[contentType]
}

export {
  getBuiltInCategories,
  rulesCategories,
  skillsCategories,
}
