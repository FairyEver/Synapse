import { useEffect, useId, useMemo, useState } from "react"
import { CircleHelp } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { track } from "@/lib/ui-tracking"
import { cn } from "@/lib/utils"
import type {
  SynapseAgentPermissionRequestTimelineItem,
  SynapseAgentUserQuestion,
} from "@/types/agent"
import { formatAgentInputText, sanitizeAgentRawInput } from "../utils"

const ASK_USER_QUESTION_EMPTY_ANSWER_MESSAGE = "未收到选择，已停止操作。"

type AgentUserQuestionCardProps = {
  readonly item: SynapseAgentPermissionRequestTimelineItem
  readonly pending: boolean
  readonly isLatestPending: boolean
  readonly onRespond: (
    requestId: string,
    behavior: "allow" | "deny",
    updatedInput?: Record<string, unknown>,
    message?: string,
  ) => void | Promise<void>
}

type AnswerState = Record<number, readonly string[]>

function AgentUserQuestionCard({
  item,
  pending,
  isLatestPending,
  onRespond,
}: AgentUserQuestionCardProps) {
  const questions = useMemo(() => userQuestions(item), [item])
  const domIdPrefix = useId()
  const [answers, setAnswers] = useState<AnswerState>({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (submitting && !pending) {
      setSubmitting(false)
    }
  }, [submitting, pending])

  const complete = questions.length > 0
    && questions.every((question, index) => (answers[index]?.length ?? 0) > 0)
  const body = item.toolInput ? formatAgentInputText(item.toolInput) : formatRawInput(item.toolInputRaw)

  function selectSingle(index: number, value: string) {
    setAnswers((current) => ({ ...current, [index]: [value] }))
  }

  function toggleMulti(index: number, value: string, checked: boolean) {
    setAnswers((current) => {
      const selected = new Set(current[index] ?? [])
      if (checked) selected.add(value)
      else selected.delete(value)
      return { ...current, [index]: [...selected] }
    })
  }

  async function handleSubmit() {
    if (submitting || !complete) return
    setSubmitting(true)
    const answerRecord = Object.fromEntries(
      questions.map((question, index) => [questionAnswerKey(question, index), (answers[index] ?? []).join(", ")]),
    )
    track({
      component: "agent",
      name: "agent-user-question-card-response",
      action: "submit",
      metadata: {
        boundary: "renderer.agent.user-question-response",
        itemId: item.id,
        requestId: item.requestId,
        questionCount: questions.length,
        answerCount: Object.keys(answerRecord).length,
        hasMultiSelect: questions.some((question) => question.multiSelect === true),
      },
    })
    try {
      await onRespond(item.requestId, "allow", {
        questions,
        answers: answerRecord,
      })
    } catch {
      setSubmitting(false)
    }
  }

  async function handleSkip() {
    if (submitting) return
    setSubmitting(true)
    track({
      component: "agent",
      name: "agent-user-question-card-response",
      action: "submit",
      value: "skip",
      metadata: {
        boundary: "renderer.agent.user-question-response",
        itemId: item.id,
        requestId: item.requestId,
        questionCount: questions.length,
      },
    })
    try {
      await onRespond(item.requestId, "deny", undefined, ASK_USER_QUESTION_EMPTY_ANSWER_MESSAGE)
    } catch {
      setSubmitting(false)
    }
  }

  return (
    <div
      data-agent-permission-request-id={item.requestId}
      className={cn(
        "my-1 overflow-hidden rounded-lg border border-border bg-card",
        isLatestPending && pending && "ring-2 ring-primary",
      )}
    >
      <div className="flex items-center gap-2 bg-muted/30 px-3 py-2">
        <CircleHelp className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-semibold">{questions[0]?.header ?? "需要选择"}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {!pending ? (
            <Badge variant="secondary">已处理</Badge>
          ) : null}
        </div>
      </div>

      {questions.length > 0 ? (
        <div className="flex flex-col gap-4 border-t border-border p-3">
          {questions.map((question, index) => (
            <QuestionBlock
              key={`${question.question}:${index}`}
              question={question}
              index={index}
              idPrefix={`${domIdPrefix}-${index}`}
              selected={answers[index] ?? []}
              disabled={!pending || submitting}
              onSelectSingle={selectSingle}
              onToggleMulti={toggleMulti}
            />
          ))}
        </div>
      ) : body ? (
        <div className="border-t border-border bg-muted p-3">
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">{body}</pre>
        </div>
      ) : null}

      {pending ? (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={submitting}
            onClick={() => void handleSkip()}
          >
            不回答
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!complete || submitting}
            onClick={() => void handleSubmit()}
          >
            提交
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function QuestionBlock({
  question,
  index,
  idPrefix,
  selected,
  disabled,
  onSelectSingle,
  onToggleMulti,
}: {
  readonly question: SynapseAgentUserQuestion
  readonly index: number
  readonly idPrefix: string
  readonly selected: readonly string[]
  readonly disabled: boolean
  readonly onSelectSingle: (index: number, value: string) => void
  readonly onToggleMulti: (index: number, value: string, checked: boolean) => void
}) {
  const options = question.options ?? []
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        {question.header ? (
          <Badge variant="secondary" className="h-5 text-xs">{question.header}</Badge>
        ) : null}
        <p className="text-sm font-medium">{question.question}</p>
      </div>
      {question.multiSelect ? (
        <div className="grid gap-2">
          {options.map((option, optionIndex) => {
            const optionId = `agent-question-${idPrefix}-${optionIndex}`
            return (
              <Label
                key={optionId}
                htmlFor={optionId}
                className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2"
              >
                <Checkbox
                  id={optionId}
                  checked={selected.includes(option.label)}
                  disabled={disabled}
                  onCheckedChange={(checked) => onToggleMulti(index, option.label, checked === true)}
                />
                <OptionText label={option.label} description={option.description} />
              </Label>
            )
          })}
        </div>
      ) : (
        <RadioGroup
          value={selected[0] ?? ""}
          disabled={disabled}
          onValueChange={(value) => onSelectSingle(index, value)}
        >
          {options.map((option, optionIndex) => {
            const optionId = `agent-question-${idPrefix}-${optionIndex}`
            return (
              <Label
                key={optionId}
                htmlFor={optionId}
                className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2"
              >
                <RadioGroupItem id={optionId} value={option.label} />
                <OptionText label={option.label} description={option.description} />
              </Label>
            )
          })}
        </RadioGroup>
      )}
    </div>
  )
}

function OptionText({
  label,
  description,
}: {
  readonly label: string
  readonly description?: string
}) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="text-sm font-medium">{label}</span>
      {description ? (
        <span className="text-xs leading-5 text-muted-foreground">{description}</span>
      ) : null}
    </span>
  )
}

function userQuestions(item: SynapseAgentPermissionRequestTimelineItem): readonly SynapseAgentUserQuestion[] {
  if (item.questions?.length) return item.questions
  const rawQuestions = item.toolInputRaw?.questions
  return Array.isArray(rawQuestions) ? parseQuestions(rawQuestions) : []
}

function parseQuestions(rawQuestions: readonly unknown[]): readonly SynapseAgentUserQuestion[] {
  const questions: SynapseAgentUserQuestion[] = []
  for (const rawQuestion of rawQuestions) {
    const record = rawQuestion && typeof rawQuestion === "object" && !Array.isArray(rawQuestion)
      ? rawQuestion as Record<string, unknown>
      : undefined
    const question = typeof record?.question === "string" ? record.question : undefined
    const rawOptions = Array.isArray(record?.options) ? record.options : undefined
    if (!question || !rawOptions) return []
    const options = rawOptions.map((rawOption) => {
      const option = rawOption && typeof rawOption === "object" && !Array.isArray(rawOption)
        ? rawOption as Record<string, unknown>
        : undefined
      const label = typeof option?.label === "string" ? option.label : undefined
      if (!label) return undefined
      const description = typeof option?.description === "string" ? option.description : undefined
      return {
        label,
        ...(description ? { description } : {}),
      }
    })
    if (options.some((option) => !option)) return []
    const header = typeof record?.header === "string" ? record.header : undefined
    const id = questionId(record)
    questions.push({
      ...(id ? { id } : {}),
      question,
      ...(header ? { header } : {}),
      options: options as SynapseAgentUserQuestion["options"],
      multiSelect: typeof record?.multiSelect === "boolean" ? record.multiSelect : false,
    })
  }
  return questions
}

function questionAnswerKey(question: SynapseAgentUserQuestion, index: number): string {
  return questionId(question as unknown as Record<string, unknown>) ?? `question-${index}`
}

function questionId(record: Record<string, unknown> | undefined): string | undefined {
  const id = typeof record?.id === "string" && record.id.trim() ? record.id.trim() : undefined
  if (id) return id
  return typeof record?.key === "string" && record.key.trim() ? record.key.trim() : undefined
}

function formatRawInput(value: Record<string, unknown> | undefined): string {
  return value ? JSON.stringify(sanitizeAgentRawInput(value), null, 2) : ""
}

export { AgentUserQuestionCard }
