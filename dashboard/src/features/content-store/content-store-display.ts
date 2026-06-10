import { FileText, MessageSquareText, ScrollText, Wrench } from 'lucide-react'
import type { ContentStoreType } from '@synapse/shared'

export const contentStoreTypeLabels = {
  skill: 'Skill',
  rule: 'Rule',
  prompt: 'Prompt',
} satisfies Record<ContentStoreType, string>

export const contentStoreTypeIcons = {
  skill: Wrench,
  rule: ScrollText,
  prompt: MessageSquareText,
} satisfies Record<ContentStoreType, typeof FileText>

export function getContentStoreTypeLabel(type: ContentStoreType) {
  return contentStoreTypeLabels[type]
}

export function formatContentStoreSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB'] as const
  let value = size
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const digits = value >= 10 || unitIndex === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unitIndex]}`
}

export function formatContentStoreDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function getContentStoreOwnerName(owner: { displayName: string | null }) {
  return owner.displayName?.trim() || '-'
}
