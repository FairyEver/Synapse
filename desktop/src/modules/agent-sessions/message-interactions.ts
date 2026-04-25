import type {
  SynapseCardButton,
  SynapseCardElement,
  SynapseInteractionDispatch,
  SynapseMessageInteraction,
  SynapseRenderableMessage,
  SynapseRichCard,
  SynapseSessionMessage,
} from "@/types/agent-session"

export type MessageRenderCapabilities = {
  card?: boolean
  buttons?: boolean
}

function buttonInteraction(button: SynapseCardButton, row: number): SynapseMessageInteraction {
  return {
    kind: "button",
    text: button.text,
    value: button.value,
    row,
    ...(button.type ? { buttonType: button.type } : undefined),
    ...(button.extra ? { extra: { ...button.extra } } : undefined),
  }
}

function renderElementText(element: SynapseCardElement): string {
  switch (element.type) {
    case "markdown":
      return `${element.content}\n\n`
    case "divider":
      return "---\n\n"
    case "actions":
      return element.buttons.map((button) => `[${button.text}]`).join("  ") + "\n\n"
    case "list_item":
      return `${element.text}  [${element.buttonText}]\n`
    case "select":
      return `${element.placeholder}: ${element.options.map((option) => option.text).join(" | ")}\n\n`
    case "note":
      return `${element.text}\n`
  }
}

export function renderRichCardFallback(card: SynapseRichCard): string {
  const parts: string[] = []
  if (card.header?.title) {
    parts.push(`**${card.header.title}**\n\n`)
  }

  for (const element of card.elements) {
    parts.push(renderElementText(element))
  }

  return parts.join("").replace(/\n+$/u, "")
}

export function collectRichCardInteractions(card: SynapseRichCard): SynapseMessageInteraction[] {
  const interactions: SynapseMessageInteraction[] = []
  let row = 0

  for (const element of card.elements) {
    switch (element.type) {
      case "actions":
        for (const button of element.buttons) {
          interactions.push(buttonInteraction(button, row))
        }
        row += 1
        break
      case "list_item":
        interactions.push({
          kind: "button",
          text: element.buttonText,
          value: element.buttonValue,
          row,
          ...(element.buttonType ? { buttonType: element.buttonType } : undefined),
          ...(element.extra ? { extra: { ...element.extra } } : undefined),
        })
        row += 1
        break
      case "select":
        interactions.push({
          kind: "select",
          placeholder: element.placeholder,
          options: element.options.map((option) => ({ ...option })),
          row,
          ...(element.initValue ? { initValue: element.initValue } : undefined),
        })
        row += 1
        break
      case "markdown":
      case "divider":
      case "note":
        break
    }
  }

  return interactions
}

export function richCardHasInteractions(card: SynapseRichCard): boolean {
  return collectRichCardInteractions(card).length > 0
}

export function toRenderableMessage(
  message: SynapseSessionMessage,
  capabilities: MessageRenderCapabilities = {},
): SynapseRenderableMessage {
  const fallbackText = message.card ? renderRichCardFallback(message.card) : message.content
  const cardInteractions = message.card ? collectRichCardInteractions(message.card) : []
  const interactions = capabilities.buttons === false ? [] : (message.interactions ?? cardInteractions)
  const hasUnsupportedInteractions = cardInteractions.length > 0 && capabilities.buttons === false

  return {
    ...message,
    fallbackText,
    interactions,
    canRenderCard: Boolean(message.card && capabilities.card !== false && !hasUnsupportedInteractions),
  }
}

export function resolveInteractionDispatch(action: string): SynapseInteractionDispatch {
  if (action === "perm:allow") {
    return { kind: "message", content: "allow" }
  }
  if (action === "perm:deny") {
    return { kind: "message", content: "deny" }
  }
  if (action === "perm:allow_all") {
    return { kind: "message", content: "allow all" }
  }
  if (action.startsWith("askq:")) {
    return { kind: "message", content: action }
  }
  if (action.startsWith("cmd:")) {
    return { kind: "message", content: action.slice("cmd:".length) }
  }
  if (action.startsWith("nav:") || action.startsWith("act:")) {
    return { kind: "navigation", action }
  }

  return { kind: "unsupported", action }
}
