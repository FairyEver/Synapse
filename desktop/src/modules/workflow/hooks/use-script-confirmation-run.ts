import { useCallback, useEffect, useRef, useState } from "react"

import type { ImportedScriptConfirmationItem } from "../editor/script-confirmation-dialog"

type OperationPhase = "initial" | "review" | "confirming" | "settled"

type ScriptConfirmationOperation = {
  readonly id: number
  phase: OperationPhase
  token?: string
  scripts: readonly ImportedScriptConfirmationItem[]
  readonly invoke: (confirmationToken?: string) => Promise<unknown>
  readonly promise: Promise<unknown | null>
  readonly resolve: (result: unknown | null) => void
  readonly reject: (error: unknown) => void
}

export function useScriptConfirmationRun() {
  const operationRef = useRef<ScriptConfirmationOperation | null>(null)
  const nextOperationIdRef = useRef(1)
  const mountedRef = useRef(true)
  const [scripts, setScripts] = useState<readonly ImportedScriptConfirmationItem[]>([])
  const [confirming, setConfirming] = useState(false)

  const renderOperation = useCallback((
    operation: ScriptConfirmationOperation | null,
    isConfirming = false,
  ) => {
    if (!mountedRef.current) return
    setScripts(operation?.scripts ?? [])
    setConfirming(isConfirming)
  }, [])

  const settleOperation = useCallback((
    operation: ScriptConfirmationOperation,
    result: { readonly value: unknown | null } | { readonly error: unknown },
  ) => {
    if (operation.phase === "settled") return
    operation.phase = "settled"
    if (operationRef.current === operation) {
      operationRef.current = null
      renderOperation(null)
    }
    if ("error" in result) operation.reject(result.error)
    else operation.resolve(result.value)
  }, [renderOperation])

  const applyInvocationResult = useCallback((
    operation: ScriptConfirmationOperation,
    result: unknown,
  ) => {
    if (operationRef.current !== operation || operation.phase === "settled") return
    const review = readScriptConfirmation(result)
    if (!review) {
      settleOperation(operation, { value: result })
      return
    }
    operation.phase = "review"
    operation.token = review.token
    operation.scripts = review.scripts
    renderOperation(operation)
  }, [renderOperation, settleOperation])

  const runWithScriptConfirmation = useCallback(<T,>(
    invoke: (confirmationToken?: string) => Promise<T>,
  ): Promise<T | null> => {
    const active = operationRef.current
    if (active && active.phase !== "settled") {
      return active.promise as Promise<T | null>
    }

    let resolveOperation!: (result: unknown | null) => void
    let rejectOperation!: (error: unknown) => void
    const promise = new Promise<unknown | null>((resolve, reject) => {
      resolveOperation = resolve
      rejectOperation = reject
    })
    const operation: ScriptConfirmationOperation = {
      id: nextOperationIdRef.current,
      phase: "initial",
      scripts: [],
      invoke,
      promise,
      resolve: resolveOperation,
      reject: rejectOperation,
    }
    nextOperationIdRef.current += 1
    operationRef.current = operation

    let invocation: Promise<unknown>
    try {
      invocation = operation.invoke()
    } catch (error) {
      settleOperation(operation, { error })
      return promise as Promise<T | null>
    }
    void invocation
      .then((result) => applyInvocationResult(operation, result))
      .catch((error) => settleOperation(operation, { error }))

    return promise as Promise<T | null>
  }, [applyInvocationResult, settleOperation])

  const cancelScriptConfirmation = useCallback(() => {
    const operation = operationRef.current
    if (!operation || operation.phase !== "review") return
    settleOperation(operation, { value: null })
  }, [settleOperation])

  const confirmScripts = useCallback((): Promise<void> => {
    const operation = operationRef.current
    if (!operation || operation.phase !== "review" || !operation.token) {
      return Promise.resolve()
    }
    operation.phase = "confirming"
    renderOperation(operation, true)
    let invocation: Promise<unknown>
    try {
      invocation = operation.invoke(operation.token)
    } catch (error) {
      settleOperation(operation, { error })
      return Promise.resolve()
    }
    return invocation
      .then((result) => applyInvocationResult(operation, result))
      .catch((error) => settleOperation(operation, { error }))
  }, [applyInvocationResult, renderOperation, settleOperation])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      const operation = operationRef.current
      operationRef.current = null
      if (operation && operation.phase !== "settled") {
        operation.phase = "settled"
        operation.resolve(null)
      }
    }
  }, [])

  return {
    runWithScriptConfirmation,
    scriptConfirmation: {
      open: scripts.length > 0,
      scripts,
      confirming,
      cancel: cancelScriptConfirmation,
      confirm: confirmScripts,
    },
  }
}

function readScriptConfirmation(result: unknown): {
  readonly token: string
  readonly scripts: readonly ImportedScriptConfirmationItem[]
} | null {
  if (!isRecord(result) || !Array.isArray(result.errors)) return null
  const confirmation = result.errors.find((error) =>
    isRecord(error) && error.type === "script_confirmation_required")
  if (!isRecord(confirmation)) return null
  const details = isRecord(confirmation.details) ? confirmation.details : {}
  const token = details.confirmationToken
  const rawScripts = details.scripts
  if (typeof token !== "string" || !token || !Array.isArray(rawScripts)) return null
  return {
    token,
    scripts: rawScripts.map((script) => {
      const item = isRecord(script) ? script : {}
      return {
        workflowName: typeof item.workflowName === "string" ? item.workflowName : "未命名工作流",
        runtime: typeof item.runtime === "string" ? item.runtime : "脚本",
        nodeName: typeof item.nodeName === "string" ? item.nodeName : "未命名节点",
        source: typeof item.source === "string" ? item.source : "",
      }
    }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
