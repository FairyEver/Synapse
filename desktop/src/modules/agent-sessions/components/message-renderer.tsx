import { Fragment } from "react"
import { Button } from "@/components/ui/button"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Separator } from "@/components/ui/separator"
import type {
  SynapseCardButton,
  SynapseCardElement,
  SynapseMessageInteraction,
  SynapseSessionMessage,
} from "@/types/agent-session"
import { toRenderableMessage } from "../message-interactions"

type MessageRendererProps = {
  message: SynapseSessionMessage
  supportsCard?: boolean
  supportsButtons?: boolean
  onInteraction?: (interaction: SynapseMessageInteraction) => void
}

function buttonVariant(type: string | undefined): "default" | "outline" | "destructive" {
  if (type === "primary") {
    return "default"
  }
  if (type === "danger") {
    return "destructive"
  }
  return "outline"
}

function renderMarkdown(content: string) {
  return <p className="whitespace-pre-wrap text-sm leading-relaxed">{content}</p>
}

function renderActionButton(
  button: SynapseCardButton,
  row: number,
  onInteraction: MessageRendererProps["onInteraction"],
) {
  return (
    <Button
      key={`${button.value}:${button.text}`}
      type="button"
      size="sm"
      variant={buttonVariant(button.type)}
      onClick={() => onInteraction?.({
        kind: "button",
        text: button.text,
        value: button.value,
        row,
        ...(button.type ? { buttonType: button.type } : undefined),
        ...(button.extra ? { extra: { ...button.extra } } : undefined),
      })}
    >
      {button.text}
    </Button>
  )
}

function RichElement({
  element,
  row,
  onInteraction,
}: {
  element: SynapseCardElement
  row: number
  onInteraction: MessageRendererProps["onInteraction"]
}) {
  switch (element.type) {
    case "markdown":
      return renderMarkdown(element.content)
    case "divider":
      return <Separator />
    case "actions":
      return (
        <div className="flex flex-wrap items-center gap-2">
          {element.buttons.map((button) => renderActionButton(button, row, onInteraction))}
        </div>
      )
    case "list_item":
      return (
        <div className="grid grid-cols-[1fr_auto] items-center gap-3">
          {renderMarkdown(element.text)}
          <Button
            type="button"
            size="sm"
            variant={buttonVariant(element.buttonType)}
            onClick={() => onInteraction?.({
              kind: "button",
              text: element.buttonText,
              value: element.buttonValue,
              row,
              ...(element.buttonType ? { buttonType: element.buttonType } : undefined),
              ...(element.extra ? { extra: { ...element.extra } } : undefined),
            })}
          >
            {element.buttonText}
          </Button>
        </div>
      )
    case "select":
      return (
        <NativeSelect
          size="sm"
          defaultValue={element.initValue}
          aria-label={element.placeholder}
          onChange={(event) => onInteraction?.({
            kind: "select",
            placeholder: element.placeholder,
            options: element.options.map((option) => ({ ...option })),
            initValue: event.currentTarget.value,
            row,
          })}
        >
          <NativeSelectOption value="">{element.placeholder}</NativeSelectOption>
          {element.options.map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.text}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )
    case "note":
      return <p className="text-xs text-muted-foreground">{element.text}</p>
  }
}

function MessageRenderer({
  message,
  supportsCard = true,
  supportsButtons = true,
  onInteraction,
}: MessageRendererProps) {
  const renderable = toRenderableMessage(message, {
    card: supportsCard,
    buttons: supportsButtons,
  })

  if (!renderable.card || !renderable.canRenderCard) {
    return (
      <div className="max-w-full whitespace-pre-wrap text-sm leading-relaxed">
        {renderable.fallbackText}
      </div>
    )
  }

  return (
    <div className="rounded-md border bg-background">
      {renderable.card.header?.title ? (
        <div className="border-b px-3 py-2 text-sm font-medium">{renderable.card.header.title}</div>
      ) : null}
      <div className="flex flex-col gap-3 p-3">
        {renderable.card.elements.map((element, index) => (
          <Fragment key={`${element.type}:${index}`}>
            <RichElement element={element} row={index} onInteraction={onInteraction} />
          </Fragment>
        ))}
      </div>
    </div>
  )
}

export { MessageRenderer }
