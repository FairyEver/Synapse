import type { SynapseQuickInput } from "@/types/config"

function createQuickInputId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  return `quick-input-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function quickInputPreview(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?? content.trim()
}

function createQuickInput(content: string): SynapseQuickInput {
  return {
    id: createQuickInputId(),
    content,
  }
}

function updateQuickInput(
  items: readonly SynapseQuickInput[],
  id: string,
  content: string,
): SynapseQuickInput[] {
  return items.map((item) => item.id === id ? { ...item, content } : item)
}

function deleteQuickInput(
  items: readonly SynapseQuickInput[],
  id: string,
): SynapseQuickInput[] {
  return items.filter((item) => item.id !== id)
}

function pinQuickInputToTop(
  items: readonly SynapseQuickInput[],
  id: string,
): SynapseQuickInput[] {
  const target = items.find((item) => item.id === id)
  if (!target) {
    return [...items]
  }

  return [
    target,
    ...items.filter((item) => item.id !== id),
  ]
}

export {
  createQuickInput,
  createQuickInputId,
  deleteQuickInput,
  pinQuickInputToTop,
  quickInputPreview,
  updateQuickInput,
}
