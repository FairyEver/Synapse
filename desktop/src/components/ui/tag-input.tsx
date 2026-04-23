import { useCallback, useRef, useState, type KeyboardEvent } from "react"
import { X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type TagInputProps = {
  value: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

function TagInput({ value, onChange, placeholder, disabled, className }: TagInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [composing, setComposing] = useState(false)

  const addTag = useCallback(
    (raw: string) => {
      const tag = raw.trim()
      if (!tag || value.includes(tag)) return
      onChange([...value, tag])
    },
    [value, onChange],
  )

  const removeTag = useCallback(
    (tag: string) => {
      onChange(value.filter((v) => v !== tag))
    },
    [value, onChange],
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (composing) return

      const input = inputRef.current
      if (!input) return

      if (e.key === "Enter") {
        e.preventDefault()
        addTag(input.value)
        input.value = ""
        return
      }

      if (e.key === "Backspace" && input.value === "" && value.length > 0) {
        onChange(value.slice(0, -1))
      }
    },
    [addTag, composing, onChange, value],
  )

  const handleBlur = useCallback(() => {
    const input = inputRef.current
    if (!input || !input.value.trim()) return
    addTag(input.value)
    input.value = ""
  }, [addTag])

  return (
    <div
      className={cn(
        "flex min-h-8 flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-2 py-1 text-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((tag) => (
        <Badge key={tag} variant="secondary" className="gap-0.5 pr-1">
          {tag}
          <button
            type="button"
            className="ml-0.5 rounded-full p-0 hover:text-destructive focus:outline-none"
            onClick={(e) => {
              e.stopPropagation()
              removeTag(tag)
            }}
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <input
        ref={inputRef}
        disabled={disabled}
        placeholder={value.length === 0 ? placeholder : undefined}
        className="min-w-16 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
      />
    </div>
  )
}

export { TagInput }
