import type { MeetingMinutesDto, MeetingTodoDto } from "@synapse/shared"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import type { SynapseMeetingDetail } from "@/types/meeting"

/**
 * 纪要。
 *
 * 分议题、结论、待办三段。纪要由逐字稿生成，但生成之后归用户所有——每一行都能改，
 * 待办能勾，负责人和时间能填。
 */

function emptyMinutes(): MeetingMinutesDto {
  return { topics: [], conclusions: [], todos: [], editedAt: null }
}

function todoKey(todo: MeetingTodoDto, index: number): string {
  return todo.id || `todo-${index}`
}

function newTodoId(): string {
  return `todo-${Math.random().toString(36).slice(2, 10)}`
}

type MeetingMinutesViewProps = {
  readonly meeting: SynapseMeetingDetail
  readonly busy: boolean
  readonly onSave: (minutes: MeetingMinutesDto) => Promise<void>
  readonly onGenerate: () => Promise<void>
}

export function MeetingMinutesView(props: MeetingMinutesViewProps) {
  const { meeting } = props
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<MeetingMinutesDto>(() => meeting.minutes ?? emptyMinutes())
  const [saving, setSaving] = useState(false)

  const busy = props.busy || saving
  const minutes = meeting.minutes
  const generating = meeting.minutesStatus === "generating"
  const hasSegments = meeting.segments.length > 0

  function startEditing(): void {
    setDraft(meeting.minutes ?? emptyMinutes())
    setEditing(true)
  }

  async function save(): Promise<void> {
    if (saving) return
    setSaving(true)
    try {
      await props.onSave(draft)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (!minutes && !editing) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>还没有纪要</EmptyTitle>
          <EmptyDescription>
            {generating
              ? "正在根据逐字稿整理，稍后回来看看。"
              : hasSegments
                ? "由逐字稿生成议题、结论和待办。"
                : "转写完成后才能生成纪要。"}
          </EmptyDescription>
        </EmptyHeader>
        <div className="mt-3">
          <Button
            disabled={busy || generating || !hasSegments}
            onClick={() => void props.onGenerate()}
          >
            生成纪要
          </Button>
        </div>
      </Empty>
    )
  }

  const view = editing ? draft : (minutes ?? emptyMinutes())

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        {editing ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={busy}>
              取消
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={busy}>
              保存
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={startEditing} disabled={busy}>
            编辑
          </Button>
        )}
      </div>

      <Section
        title="议题"
        items={view.topics}
        editing={editing}
        onChange={(topics) => setDraft({ ...view, topics })}
        placeholder="补充一个议题"
      />
      <Section
        title="结论"
        items={view.conclusions}
        editing={editing}
        onChange={(conclusions) => setDraft({ ...view, conclusions })}
        placeholder="补充一条结论"
      />

      <section className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">待办</h3>
        {view.todos.length === 0 && !editing ? (
          <p className="text-xs text-muted-foreground">没有待办。</p>
        ) : null}
        <ul className="space-y-1.5">
          {view.todos.map((todo, index) => (
            <li key={todoKey(todo, index)} className="flex items-start gap-2">
              <Checkbox
                checked={todo.done}
                disabled={!editing}
                onCheckedChange={(checked) => {
                  const todos = [...view.todos]
                  todos[index] = { ...todo, done: checked === true }
                  setDraft({ ...view, todos })
                }}
                className="mt-0.5"
              />
              {editing ? (
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Input
                    value={todo.text}
                    onChange={(event) => {
                      const todos = [...view.todos]
                      todos[index] = { ...todo, text: event.target.value }
                      setDraft({ ...view, todos })
                    }}
                    className="flex-1"
                  />
                  <Input
                    value={todo.owner ?? ""}
                    placeholder="负责人"
                    onChange={(event) => {
                      const todos = [...view.todos]
                      todos[index] = { ...todo, owner: event.target.value || null }
                      setDraft({ ...view, todos })
                    }}
                    className="w-24"
                  />
                  <Input
                    value={todo.due ?? ""}
                    placeholder="时间"
                    onChange={(event) => {
                      const todos = [...view.todos]
                      todos[index] = { ...todo, due: event.target.value || null }
                      setDraft({ ...view, todos })
                    }}
                    className="w-24"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDraft({ ...view, todos: view.todos.filter((_, at) => at !== index) })}
                  >
                    删除
                  </Button>
                </div>
              ) : (
                <div className="min-w-0 flex-1">
                  <p className={todo.done ? "text-sm text-muted-foreground line-through" : "text-sm"}>{todo.text}</p>
                  {todo.owner || todo.due ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {[todo.owner, todo.due].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
        {editing ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setDraft({
                ...view,
                todos: [...view.todos, { id: newTodoId(), text: "", owner: null, due: null, done: false }],
              })
            }
          >
            添加待办
          </Button>
        ) : null}
      </section>

      {meeting.minutesFailureReason && !minutes ? (
        <p className="text-xs text-destructive">{meeting.minutesFailureReason}</p>
      ) : null}
    </div>
  )
}

type SectionProps = {
  readonly title: string
  readonly items: readonly string[]
  readonly editing: boolean
  readonly placeholder: string
  readonly onChange: (items: string[]) => void
}

function Section(props: SectionProps) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">{props.title}</h3>
      {props.items.length === 0 && !props.editing ? (
        <p className="text-xs text-muted-foreground">没有{props.title}。</p>
      ) : null}
      <ul className="space-y-1.5">
        {props.items.map((item, index) => (
          <li key={`${props.title}-${index}`} className="flex items-start gap-2">
            {props.editing ? (
              <>
                <Input
                  value={item}
                  onChange={(event) => {
                    const items = [...props.items]
                    items[index] = event.target.value
                    props.onChange(items)
                  }}
                  className="flex-1"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => props.onChange(props.items.filter((_, at) => at !== index))}
                >
                  删除
                </Button>
              </>
            ) : (
              <>
                <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
                <p className="text-sm">{item}</p>
              </>
            )}
          </li>
        ))}
      </ul>
      {props.editing ? (
        <Button variant="outline" size="sm" onClick={() => props.onChange([...props.items, ""])}>
          {props.placeholder}
        </Button>
      ) : null}
    </section>
  )
}
