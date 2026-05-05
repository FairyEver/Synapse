import * as React from "react"
import { Input } from "@/components/ui/input"
import { adminApi } from "@/lib/api"

export function InlineNote({
  accountId,
  value,
  onSaved,
}: {
  readonly accountId: string
  readonly value: string | null
  readonly onSaved?: (note: string | null) => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value ?? "")
  const [saving, setSaving] = React.useState(false)

  async function save() {
    const trimmed = draft.trim() || null
    if (trimmed === (value ?? null)) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await adminApi.updateAccountNote(accountId, trimmed)
      onSaved?.(trimmed)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <Input
        className="h-7 w-32 text-xs"
        maxLength={100}
        autoFocus
        disabled={saving}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === "Enter") void save()
          if (event.key === "Escape") {
            setDraft(value ?? "")
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <button
      type="button"
      className="inline-block max-w-32 truncate rounded px-1 text-left text-xs text-muted-foreground hover:bg-muted"
      onClick={() => {
        setDraft(value ?? "")
        setEditing(true)
      }}
    >
      {value || "—"}
    </button>
  )
}
