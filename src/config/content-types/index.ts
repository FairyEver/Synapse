import type { SynapseContentType } from "../../types/content"
import { ruleContentTypeDefinition } from "./rule"
import { skillContentTypeDefinition } from "./skill"
import type { ContentTypeDefinition } from "./types"

export const CONTENT_TYPE_REGISTRY = {
  rule: ruleContentTypeDefinition,
  skill: skillContentTypeDefinition,
} as const satisfies Record<SynapseContentType, ContentTypeDefinition>

export const CONTENT_TYPE_DEFINITIONS: readonly ContentTypeDefinition[] =
  Object.values(CONTENT_TYPE_REGISTRY)

export function getContentTypeDefinition(id: SynapseContentType): ContentTypeDefinition {
  return CONTENT_TYPE_REGISTRY[id]
}

export function getAllContentTypeIds(): SynapseContentType[] {
  return Object.keys(CONTENT_TYPE_REGISTRY) as SynapseContentType[]
}

export type { ContentTypeDefinition } from "./types"
