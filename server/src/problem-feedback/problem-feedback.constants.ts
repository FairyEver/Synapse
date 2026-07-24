export const PROBLEM_FEEDBACK_PUBLIC_PATH = "/api/problem-feedback"
export const PROBLEM_FEEDBACK_HTTP_MAX_BYTES = 1024 * 1024
export const PROBLEM_FEEDBACK_PAGE_SIZE = 10
export const PROBLEM_FEEDBACK_RETENTION_DAYS = 180
export const PROBLEM_FEEDBACK_RETENTION_BATCH_SIZE = 1000
export const PROBLEM_FEEDBACK_RETENTION_INTERVAL_MS = 60 * 60 * 1000

export const PROBLEM_FEEDBACK_NETWORK_BUCKET = {
  capacity: 3,
  refillIntervalMs: 10 * 60 * 1000,
} as const

export const PROBLEM_FEEDBACK_GLOBAL_BUCKET = {
  capacity: 30,
  refillIntervalMs: 60 * 1000,
} as const
