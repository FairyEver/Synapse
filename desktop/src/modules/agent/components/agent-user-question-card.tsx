import { type ReactNode, useEffect, useId, useMemo, useState } from "react"
import { CircleHelp } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { track } from "@/lib/ui-tracking"
import { cn } from "@/lib/utils"
import type {
  SynapseAgentPermissionRequestTimelineItem,
  SynapseAgentUserQuestion,
  SynapseAgentUserQuestionResolution,
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
  const [answers, setAnswers] = useState<AnswerState>(() => answerStateFromResolution(item.resolution))
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (submitting && !pending) {
      setSubmitting(false)
    }
  }, [submitting, pending])

  useEffect(() => {
    if (item.resolution) setAnswers(answerStateFromResolution(item.resolution))
  }, [item.resolution])

  const complete = questions.length > 0
    && questions.every((question, index) => (answers[index]?.length ?? 0) > 0)
  const body = item.toolInput ? formatAgentInputText(item.toolInput) : formatRawInput(item.toolInputRaw)
  const interactive = pending && !item.resolution

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
      questions.map((question, index) => [
        questionAnswerKey(question, index),
        question.multiSelect ? answers[index] ?? [] : answers[index]?.[0] ?? "",
      ]),
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
      setAnswers({})
    } catch {
      setSubmitting(false)
    }
  }

  return (
    <Card
      data-agent-permission-request-id={item.requestId}
      className={cn(
        "my-1 min-w-0 max-w-full gap-0 py-0",
        isLatestPending && interactive && "ring-2 ring-primary",
      )}
    >
      <CardHeader className="flex min-w-0 flex-row items-center gap-2 rounded-none px-3 py-2">
        <CircleHelp className="size-4 shrink-0 text-muted-foreground" />
        <CardTitle className="min-w-0 text-sm font-semibold text-balance">需要回答</CardTitle>
        <div className="ml-auto flex items-center gap-1.5">
          {!interactive ? (
            <Badge variant="secondary">{resolutionStatusLabel(item.resolution)}</Badge>
          ) : null}
        </div>
      </CardHeader>

      {questions.length > 0 ? (
        <CardContent className="flex min-w-0 flex-col gap-4 border-t border-border px-3 py-3">
          {questions.map((question, index) => (
            <QuestionBlock
              key={`${question.question}:${index}`}
              question={question}
              index={index}
              idPrefix={`${domIdPrefix}-${index}`}
              selected={answers[index] ?? []}
              resolution={item.resolution}
              disabled={!interactive || submitting}
              onSelectSingle={selectSingle}
              onToggleMulti={toggleMulti}
            />
          ))}
        </CardContent>
      ) : body ? (
        <CardContent className="min-w-0 border-t border-border bg-muted px-3 py-3">
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">{body}</pre>
        </CardContent>
      ) : null}

      {interactive ? (
        <CardFooter className="gap-2 rounded-none px-3 py-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="relative after:absolute after:inset-x-0 after:-inset-y-1.5"
            disabled={submitting}
            onClick={() => void handleSkip()}
          >
            不回答
          </Button>
          <Button
            type="button"
            size="sm"
            className="relative after:absolute after:inset-x-0 after:-inset-y-1.5"
            disabled={!complete || submitting}
            onClick={() => void handleSubmit()}
          >
            提交回答
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  )
}

function QuestionBlock({
  question,
  index,
  idPrefix,
  selected,
  resolution,
  disabled,
  onSelectSingle,
  onToggleMulti,
}: {
  readonly question: SynapseAgentUserQuestion
  readonly index: number
  readonly idPrefix: string
  readonly selected: readonly string[]
  readonly resolution?: SynapseAgentUserQuestionResolution
  readonly disabled: boolean
  readonly onSelectSingle: (index: number, value: string) => void
  readonly onToggleMulti: (index: number, value: string, checked: boolean) => void
}) {
  const options = question.options ?? []
  const unmatchedAnswers = resolution?.status === "answered"
    ? selected.filter((value) => !options.some((option) => option.label === value))
    : []
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        {question.header ? (
          <p className="break-words text-xs font-medium leading-5 text-muted-foreground text-pretty">
            {question.header}
          </p>
        ) : null}
        <p className="break-words text-sm font-medium text-balance">{question.question}</p>
      </div>
      {question.multiSelect ? (
        <div className="grid gap-2">
          {options.map((option, optionIndex) => {
            const optionId = `agent-question-${idPrefix}-${optionIndex}`
            return (
              <QuestionOption
                key={optionId}
                id={optionId}
                label={option.label}
                description={option.description}
                disabled={disabled}
                control={<Checkbox
                  id={optionId}
                  checked={selected.includes(option.label)}
                  disabled={disabled}
                  onCheckedChange={(checked) => onToggleMulti(index, option.label, checked === true)}
                />}
              />
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
              <QuestionOption
                key={optionId}
                id={optionId}
                label={option.label}
                description={option.description}
                disabled={disabled}
                control={<RadioGroupItem id={optionId} value={option.label} />}
              />
            )
          })}
        </RadioGroup>
      )}
      {unmatchedAnswers.length > 0 ? (
        <p className="text-xs text-muted-foreground">已回答：{unmatchedAnswers.join("、")}</p>
      ) : null}
    </div>
  )
}

function QuestionOption({
  id,
  label,
  description,
  disabled,
  control,
}: {
  readonly id: string
  readonly label: string
  readonly description?: string
  readonly disabled: boolean
  readonly control: ReactNode
}) {
  return (
    <FieldLabel
      htmlFor={id}
      className={cn(
        "min-w-0 transition-[background-color,border-color,scale] duration-150 ease-out motion-reduce:transition-none",
        disabled
          ? "cursor-default"
          : "cursor-pointer hover:bg-muted/50 active:scale-[0.96] motion-reduce:active:scale-100",
      )}
    >
      <Field orientation="horizontal" className="min-w-0">
        {control}
        <FieldContent className="min-w-0">
          <FieldTitle className="w-auto min-w-0 break-words text-pretty">{label}</FieldTitle>
          {description ? (
            <FieldDescription className="break-words text-xs leading-5 text-pretty">
              {description}
            </FieldDescription>
          ) : null}
        </FieldContent>
      </Field>
    </FieldLabel>
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
    const id = typeof record?.id === "string" && record.id.trim() ? record.id.trim() : undefined
    const key = typeof record?.key === "string" && record.key.trim() ? record.key.trim() : undefined
    questions.push({
      ...(id ? { id } : {}),
      ...(key ? { key } : {}),
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

function answerStateFromResolution(
  resolution: SynapseAgentUserQuestionResolution | undefined,
): AnswerState {
  return Object.fromEntries(
    resolution?.answers?.map((answer) => [answer.questionIndex, answer.values]) ?? [],
  )
}

function resolutionStatusLabel(resolution: SynapseAgentUserQuestionResolution | undefined): string {
  switch (resolution?.status) {
    case "answered":
      return "已回答"
    case "skipped":
      return "未回答"
    case "timed_out":
      return "已超时"
    case "cancelled":
      return "已停止"
    default:
      return "已结束"
  }
}

function formatRawInput(value: Record<string, unknown> | undefined): string {
  return value ? JSON.stringify(sanitizeAgentRawInput(value), null, 2) : ""
}

export { AgentUserQuestionCard }
