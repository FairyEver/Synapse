import { useEffect, useRef, useState, type ComponentProps } from "react"

import { Textarea } from "../src/components/ui/textarea"
import { stringifyRecordText, tryParseRecordText } from "./records"

type RecordTextareaProps = Omit<ComponentProps<typeof Textarea>, "value" | "onChange"> & {
  readonly value: Record<string, string> | undefined
  readonly onValueChange: (value: Record<string, string>) => void
}

export function RecordTextarea({ value, onValueChange, ...props }: RecordTextareaProps) {
  const serializedValue = stringifyRecordText(value)
  const [text, setText] = useState(serializedValue)
  const lastSyncedTextRef = useRef(serializedValue)

  useEffect(() => {
    if (serializedValue === lastSyncedTextRef.current) return
    lastSyncedTextRef.current = serializedValue
    setText(serializedValue)
  }, [serializedValue])

  return (
    <Textarea
      {...props}
      value={text}
      onChange={(event) => {
        const nextText = event.target.value
        setText(nextText)

        const parsed = tryParseRecordText(nextText)
        if (!parsed.ok) return

        lastSyncedTextRef.current = stringifyRecordText(parsed.value)
        onValueChange(parsed.value)
      }}
    />
  )
}
