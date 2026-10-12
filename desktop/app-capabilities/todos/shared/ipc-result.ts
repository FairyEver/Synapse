export type TodoFailure = { status: number; code: string; message: string }
export type TodoIpcResult<T> = { ok: true; data: T } | { ok: false; failure: TodoFailure }
export class TodoCloudError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = "TodoCloudError" }
}
export function unwrapTodoResult<T>(result: TodoIpcResult<T>): T {
  if (!result.ok) throw new TodoCloudError(result.failure.status, result.failure.code, result.failure.message)
  return result.data
}
export function todoFailure(error: unknown): TodoFailure {
  if (error instanceof TodoCloudError) return { status: error.status, code: error.code, message: error.message }
  const value = error as { status?: unknown; code?: unknown }
  if (typeof value?.status === "number" && typeof value.code === "string" && /^TODO_[A-Z_]{1,50}$/u.test(value.code)) {
    return { status: value.status, code: value.code, message: value.code === "TODO_VERSION_CONFLICT" ? "事项已被修改，请重新载入" : "待办操作失败，请重试" }
  }
  return { status: 0, code: "TODO_OPERATION_FAILED", message: "待办操作失败，请重试" }
}
