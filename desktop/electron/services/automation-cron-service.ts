import { randomBytes } from "node:crypto"

export type CronSessionMode = "" | "new_per_run"

export type AutomationCronMode =
  | ""
  | "default"
  | "bypassPermissions"
  | "acceptEdits"
  | "plan"
  | "auto"
  | "dontAsk"

export type AutomationCronJob = {
  id: string
  project: string
  sessionKey: string
  cronExpr: string
  prompt: string
  exec: string
  workDir: string
  description: string
  enabled: boolean
  silent?: boolean | null
  mute?: boolean | null
  sessionMode: CronSessionMode | ""
  mode: AutomationCronMode
  timeoutMins?: number | null
  createdAt: Date
  lastRun?: Date | null
  lastError?: string
}

export type AutomationCronJobInput = Omit<AutomationCronJob, "createdAt" | "lastRun" | "lastError"> & {
  createdAt?: Date
  lastRun?: Date | null
  lastError?: string
}

export type CronExecutionPlan = {
  jobId: string
  action: "prompt" | "exec"
  project: string
  sessionKey: string
  content: string
  workDir: string | null
  mode: AutomationCronMode
  timeoutMs: number
  silent: boolean
  mute: boolean
  newSessionPerRun: boolean
  requiresPermission: boolean
}

type CronField = {
  wildcard: boolean
  values: Set<number>
}

const DEFAULT_TIMEOUT_MINS = 30
const ALLOWED_MODES = new Set(["", "default", "bypassPermissions", "acceptEdits", "plan", "auto", "dontAsk"])
const DAY_MS = 24 * 60 * 60 * 1000

function cloneDate(value: Date | null | undefined): Date | null {
  return value ? new Date(value.getTime()) : null
}

function cloneJob(job: AutomationCronJob): AutomationCronJob {
  return {
    ...job,
    createdAt: new Date(job.createdAt.getTime()),
    lastRun: cloneDate(job.lastRun),
  }
}

export function generateCronJobId(): string {
  return randomBytes(4).toString("hex")
}

export function normalizeCronSessionMode(value: string | undefined | null): CronSessionMode | "" {
  if (!value || value === "reuse") {
    return ""
  }
  if (value === "new-per-run" || value === "new_per_run") {
    return "new_per_run"
  }
  return value as CronSessionMode
}

export function cronJobUsesNewSessionPerRun(job: Pick<AutomationCronJob, "sessionMode">): boolean {
  return normalizeCronSessionMode(job.sessionMode) === "new_per_run"
}

export function cronJobExecutionTimeoutMs(job: Pick<AutomationCronJob, "timeoutMins">): number {
  if (job.timeoutMins === null || job.timeoutMins === undefined) {
    return DEFAULT_TIMEOUT_MINS * 60 * 1000
  }
  if (job.timeoutMins === 0) {
    return 0
  }
  return job.timeoutMins * 60 * 1000
}

function parseCronNumber(value: string, min: number, max: number): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`invalid cron value ${JSON.stringify(value)}`)
  }
  const parsed = Number.parseInt(value, 10)
  if (parsed < min || parsed > max) {
    throw new Error(`cron value ${parsed} outside ${min}-${max}`)
  }
  return parsed
}

function addCronRange(values: Set<number>, part: string, min: number, max: number): void {
  const [rangePart, stepPart] = part.split("/")
  const step = stepPart ? parseCronNumber(stepPart, 1, max) : 1
  let start = min
  let end = max

  if (rangePart && rangePart !== "*") {
    const [startPart, endPart] = rangePart.split("-")
    start = parseCronNumber(startPart ?? "", min, max)
    end = endPart ? parseCronNumber(endPart, min, max) : start
  }

  if (start > end) {
    throw new Error(`invalid cron range ${JSON.stringify(part)}`)
  }

  for (let value = start; value <= end; value += step) {
    values.add(value)
  }
}

function parseCronField(field: string, min: number, max: number, normalize?: (value: number) => number): CronField {
  if (field === "*") {
    return { wildcard: true, values: new Set() }
  }

  const values = new Set<number>()
  for (const part of field.split(",")) {
    if (!part) {
      throw new Error(`invalid cron field ${JSON.stringify(field)}`)
    }
    const before = new Set(values)
    addCronRange(values, part, min, max)
    if (normalize) {
      for (const value of values) {
        const normalized = normalize(value)
        if (normalized !== value) {
          values.delete(value)
          values.add(normalized)
        }
      }
      for (const value of before) {
        values.add(value)
      }
    }
  }

  return { wildcard: false, values }
}

function fieldMatches(field: CronField, value: number): boolean {
  return field.wildcard || field.values.has(value)
}

export function validateCronExpression(expr: string): void {
  parseCronExpression(expr)
}

function parseCronExpression(expr: string): [CronField, CronField, CronField, CronField, CronField] {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) {
    throw new Error(`invalid cron expression ${JSON.stringify(expr)}: expected 5 fields`)
  }

  return [
    parseCronField(fields[0] ?? "", 0, 59),
    parseCronField(fields[1] ?? "", 0, 23),
    parseCronField(fields[2] ?? "", 1, 31),
    parseCronField(fields[3] ?? "", 1, 12),
    parseCronField(fields[4] ?? "", 0, 7, (value) => (value === 7 ? 0 : value)),
  ]
}

function cronMatches(fields: readonly CronField[], date: Date): boolean {
  return (
    fieldMatches(fields[0]!, date.getMinutes())
    && fieldMatches(fields[1]!, date.getHours())
    && fieldMatches(fields[2]!, date.getDate())
    && fieldMatches(fields[3]!, date.getMonth() + 1)
    && fieldMatches(fields[4]!, date.getDay())
  )
}

export function nextCronRunAfter(expr: string, after: Date): Date {
  const fields = parseCronExpression(expr)
  const cursor = new Date(after.getTime())
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)

  const deadline = cursor.getTime() + 366 * 5 * DAY_MS
  while (cursor.getTime() <= deadline) {
    if (cronMatches(fields, cursor)) {
      return new Date(cursor.getTime())
    }
    cursor.setMinutes(cursor.getMinutes() + 1)
  }

  throw new Error(`no next run found for cron expression ${JSON.stringify(expr)}`)
}

export function cronExprToHuman(expr: string, language: "en" | "zh" | "ja" | "es" = "en"): string {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) {
    return expr
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields
  const everyDay = dayOfMonth === "*" && month === "*" && dayOfWeek === "*"
  const minuteStep = parseStep(minute)
  if (minuteStep && hour === "*" && everyDay) {
    if (language === "zh") return `每${minuteStep}分钟`
    if (language === "ja") return `${minuteStep}分ごと`
    if (language === "es") return `Cada ${minuteStep} min`
    return `Every ${minuteStep} min`
  }

  const hourStep = parseStep(hour)
  if (hourStep && everyDay) {
    const paddedMinute = minute === "*" ? "00" : padZero(minute)
    if (language === "zh") return `每${hourStep}小时 (:${paddedMinute})`
    if (language === "ja") return `${hourStep}時間ごと (:${paddedMinute})`
    if (language === "es") return `Cada ${hourStep} h (:${paddedMinute})`
    return `Every ${hourStep} h (:${paddedMinute})`
  }

  const time = hour !== "*" && minute !== "*" ? `${padZero(hour)}:${padZero(minute)}` : expr
  if (everyDay) {
    if (language === "zh") return `每天 ${time}`
    if (language === "ja") return `毎日 ${time}`
    if (language === "es") return `Diario ${time}`
    return `Daily at ${time}`
  }

  if (dayOfWeek !== "*" && dayOfMonth === "*" && month === "*") {
    const weekday = weekdayName(dayOfWeek, language)
    if (language === "zh") return `每${weekday} ${time}`
    if (language === "ja") return `毎${weekday} ${time}`
    return `Every ${weekday} at ${time}`
  }

  if (dayOfMonth !== "*" && month === "*" && dayOfWeek === "*") {
    if (language === "zh") return `每月${dayOfMonth}日 ${time}`
    if (language === "ja") return `毎月${dayOfMonth}日 ${time}`
    if (language === "es") return `Mensual, day ${dayOfMonth}, ${time}`
    return `Monthly, day ${dayOfMonth}, ${time}`
  }

  return expr
}

function parseStep(field: string | undefined): number | null {
  const match = field?.match(/^\*\/(\d+)$/)
  if (!match) {
    return null
  }
  const value = Number.parseInt(match[1] ?? "", 10)
  return value > 0 ? value : null
}

function padZero(value: string | undefined): string {
  if (!value) {
    return ""
  }
  return value.length === 1 ? `0${value}` : value
}

function weekdayName(value: string | undefined, language: "en" | "zh" | "ja" | "es"): string {
  const index = Number.parseInt(value ?? "", 10)
  const normalized = index === 7 ? 0 : index
  const names = {
    en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    zh: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"],
    ja: ["日曜", "月曜", "火曜", "水曜", "木曜", "金曜", "土曜"],
    es: ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"],
  }
  return names[language][normalized] ?? value ?? ""
}

export function validateCronJob(job: AutomationCronJobInput | AutomationCronJob): void {
  if (!job.id.trim()) {
    throw new Error("id is required")
  }
  if (!job.project.trim()) {
    throw new Error("project is required")
  }
  if (!job.sessionKey.trim()) {
    throw new Error("session_key is required")
  }
  if (!job.cronExpr.trim()) {
    throw new Error("cron_expr is required")
  }
  if (!job.prompt.trim() && !job.exec.trim()) {
    throw new Error("either prompt or exec is required")
  }
  if (job.prompt.trim() && job.exec.trim()) {
    throw new Error("prompt and exec are mutually exclusive")
  }
  validateCronExpression(job.cronExpr)

  const sessionMode = normalizeCronSessionMode(job.sessionMode)
  if (sessionMode !== "" && sessionMode !== "new_per_run") {
    throw new Error(`invalid session_mode ${JSON.stringify(job.sessionMode)}`)
  }
  if (!ALLOWED_MODES.has(job.mode)) {
    throw new Error(`invalid mode ${JSON.stringify(job.mode)}`)
  }
  if (job.timeoutMins !== undefined && job.timeoutMins !== null && job.timeoutMins < 0) {
    throw new Error("timeout_mins must be greater than or equal to 0")
  }
}

function normalizeJob(input: AutomationCronJobInput): AutomationCronJob {
  const job: AutomationCronJob = {
    id: input.id,
    project: input.project,
    sessionKey: input.sessionKey,
    cronExpr: input.cronExpr,
    prompt: input.prompt,
    exec: input.exec,
    workDir: input.workDir,
    description: input.description,
    enabled: input.enabled,
    silent: input.silent ?? null,
    mute: input.mute ?? null,
    sessionMode: normalizeCronSessionMode(input.sessionMode),
    mode: input.mode,
    timeoutMins: input.timeoutMins ?? null,
    createdAt: input.createdAt ? new Date(input.createdAt.getTime()) : new Date(),
    lastRun: cloneDate(input.lastRun),
    lastError: input.lastError,
  }
  validateCronJob(job)
  return job
}

export class AutomationCronStore {
  private readonly jobs = new Map<string, AutomationCronJob>()

  add(input: AutomationCronJobInput): AutomationCronJob {
    const job = normalizeJob(input)
    if (this.jobs.has(job.id)) {
      throw new Error(`cron job ${JSON.stringify(job.id)} already exists`)
    }
    this.jobs.set(job.id, job)
    return cloneJob(job)
  }

  remove(id: string): boolean {
    return this.jobs.delete(id)
  }

  get(id: string): AutomationCronJob | null {
    const job = this.jobs.get(id)
    return job ? cloneJob(job) : null
  }

  list(): AutomationCronJob[] {
    return [...this.jobs.values()].map(cloneJob)
  }

  listByProject(project: string): AutomationCronJob[] {
    return this.list().filter((job) => job.project === project)
  }

  listBySessionKey(sessionKey: string): AutomationCronJob[] {
    return this.list().filter((job) => job.sessionKey === sessionKey)
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const job = this.jobs.get(id)
    if (!job) {
      return false
    }
    job.enabled = enabled
    return true
  }

  setMute(id: string, mute: boolean): boolean {
    const job = this.jobs.get(id)
    if (!job) {
      return false
    }
    job.mute = mute
    return true
  }

  toggleMute(id: string): boolean | null {
    const job = this.jobs.get(id)
    if (!job) {
      return null
    }
    job.mute = !Boolean(job.mute)
    return job.mute
  }

  markRun(id: string, error?: Error | string | null, now: Date = new Date()): boolean {
    const job = this.jobs.get(id)
    if (!job) {
      return false
    }
    job.lastRun = new Date(now.getTime())
    job.lastError = error ? (typeof error === "string" ? error : error.message) : ""
    return true
  }

  update(id: string, field: string, value: unknown): AutomationCronJob | null {
    const job = this.jobs.get(id)
    if (!job || field === "id" || field === "created_at" || field === "last_run" || field === "last_error") {
      return null
    }

    const updated = cloneJob(job)
    switch (field) {
      case "project":
        updated.project = stringValue(value, field)
        break
      case "session_key":
        updated.sessionKey = stringValue(value, field)
        break
      case "cron_expr":
        updated.cronExpr = stringValue(value, field)
        break
      case "prompt":
        updated.prompt = stringValue(value, field)
        break
      case "exec":
        updated.exec = stringValue(value, field)
        break
      case "work_dir":
        updated.workDir = stringValue(value, field)
        break
      case "description":
        updated.description = stringValue(value, field)
        break
      case "session_mode":
        updated.sessionMode = normalizeCronSessionMode(stringValue(value, field))
        break
      case "mode":
        updated.mode = stringValue(value, field) as AutomationCronMode
        break
      case "enabled":
        updated.enabled = booleanValue(value, field)
        break
      case "silent":
        updated.silent = booleanValue(value, field)
        break
      case "mute":
        updated.mute = booleanValue(value, field)
        break
      case "timeout_mins":
        updated.timeoutMins = numberValue(value, field)
        break
      default:
        return null
    }

    validateCronJob(updated)
    this.jobs.set(id, updated)
    return cloneJob(updated)
  }

  replace(id: string, input: AutomationCronJobInput): AutomationCronJob | null {
    if (!this.jobs.has(id) || input.id !== id) {
      return null
    }
    const job = normalizeJob(input)
    this.jobs.set(id, job)
    return cloneJob(job)
  }
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`)
  }
  return value
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`)
  }
  return value
}

function numberValue(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${field} must be an integer`)
  }
  return value
}

export class AutomationCronScheduler {
  private readonly store: AutomationCronStore
  private defaultSessionMode: CronSessionMode | "" = ""

  constructor(store = new AutomationCronStore()) {
    this.store = store
  }

  setDefaultSessionMode(mode: string): void {
    this.defaultSessionMode = normalizeCronSessionMode(mode)
  }

  usesNewSession(job: Pick<AutomationCronJob, "sessionMode">): boolean {
    const mode = normalizeCronSessionMode(job.sessionMode)
    return mode ? mode === "new_per_run" : this.defaultSessionMode === "new_per_run"
  }

  addJob(input: AutomationCronJobInput): AutomationCronJob {
    return this.store.add({
      ...input,
      sessionMode: normalizeCronSessionMode(input.sessionMode),
    })
  }

  removeJob(id: string): boolean {
    return this.store.remove(id)
  }

  enableJob(id: string): void {
    if (!this.store.setEnabled(id, true)) {
      throw new Error(`job ${JSON.stringify(id)} not found`)
    }
  }

  disableJob(id: string): void {
    if (!this.store.setEnabled(id, false)) {
      throw new Error(`job ${JSON.stringify(id)} not found`)
    }
  }

  updateJob(id: string, field: string, value: unknown): AutomationCronJob {
    const updated = this.store.update(id, field, value)
    if (!updated) {
      throw new Error(`failed to update field ${JSON.stringify(field)}`)
    }
    return updated
  }

  replaceJob(id: string, input: AutomationCronJobInput): AutomationCronJob {
    const updated = this.store.replace(id, {
      ...input,
      sessionMode: normalizeCronSessionMode(input.sessionMode),
    })
    if (!updated) {
      throw new Error(`job ${JSON.stringify(id)} not found`)
    }
    return updated
  }

  nextRun(jobId: string, after: Date): Date | null {
    const job = this.store.get(jobId)
    if (!job || !job.enabled) {
      return null
    }
    return nextCronRunAfter(job.cronExpr, after)
  }

  createExecutionPlan(jobId: string): CronExecutionPlan {
    const job = this.store.get(jobId)
    if (!job) {
      throw new Error(`job ${JSON.stringify(jobId)} not found`)
    }
    if (!job.enabled) {
      throw new Error(`job ${JSON.stringify(jobId)} is disabled`)
    }

    const action = job.exec.trim() ? "exec" : "prompt"
    return {
      jobId,
      action,
      project: job.project,
      sessionKey: job.sessionKey,
      content: action === "exec" ? job.exec : job.prompt,
      workDir: action === "exec" && job.workDir ? job.workDir : null,
      mode: job.mode,
      timeoutMs: cronJobExecutionTimeoutMs(job),
      silent: Boolean(job.silent),
      mute: Boolean(job.mute),
      newSessionPerRun: this.usesNewSession(job),
      requiresPermission: action === "exec",
    }
  }

  markRun(jobId: string, error?: Error | string | null, now?: Date): boolean {
    return this.store.markRun(jobId, error, now)
  }

  getStore(): AutomationCronStore {
    return this.store
  }
}
