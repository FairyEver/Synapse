import { toast } from '@heroui/react'
import type { SkillHubSummary } from '@synapse/shared/skill-hub-contracts'
import { hubSegment } from './skill-hub-api'

type ShareSkill = Pick<SkillHubSummary, 'id' | 'displayName' | 'displayDescription'>

export function buildHubShareText(origin: string, skill: ShareSkill) {
  const url = new URL(`/console/skill-hub/${hubSegment(skill.id)}`, new URL(origin).origin)
  return `Skill：${skill.displayName}\n\n简介：${skill.displayDescription}\n\n链接：${url.toString()}`
}

export async function copyHubShareLink(skill: ShareSkill): Promise<void> {
  try {
    await navigator.clipboard.writeText(buildHubShareText(window.location.origin, skill))
    toast.success('已复制分享链接')
  } catch {
    toast.danger('复制失败，请重试。')
  }
}
