import { useCallback, useEffect, useRef, useState } from "react"

import { requireSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseAgentFileCheckpointDetail,
  SynapseAgentFileCheckpointDiff,
  SynapseAgentFileCheckpointPrepareResult,
} from "@/types/agent"

type FileCheckpointRequest = {
  readonly checkpointId: string
  readonly fileId?: string
  readonly action?: "review" | "rewind"
}

export function useAgentFileCheckpoint(input: {
  readonly projectId: string
  readonly conversationId: string
  readonly request: FileCheckpointRequest
  readonly onRewound: () => void | Promise<void>
}) {
  const { projectId, conversationId, request, onRewound } = input
  const [detail, setDetail] = useState<SynapseAgentFileCheckpointDetail | null>(null)
  const [selectedFileId, setSelectedFileId] = useState(request.fileId)
  const [diff, setDiff] = useState<SynapseAgentFileCheckpointDiff | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [prepared, setPrepared] = useState<SynapseAgentFileCheckpointPrepareResult | null>(null)
  const [rewinding, setRewinding] = useState(false)
  const automaticActionRef = useRef<string | null>(null)
  const preparedFileCountRef = useRef(0)

  const loadDetail = useCallback(async () => {
    return requireSynapseBridge().agent.getFileCheckpoint({
      projectId,
      conversationId,
      checkpointId: request.checkpointId,
    })
  }, [conversationId, projectId, request.checkpointId])

  useEffect(() => {
    let active = true
    setDetail(null)
    setDiff(null)
    setError(null)
    void loadDetail().then((next) => {
      if (!active) return
      setDetail(next)
      setSelectedFileId(request.fileId ?? next.files[0]?.id)
    }).catch((cause: unknown) => {
      if (active) setError(errorMessage(cause, "无法读取文件检查点。"))
    })
    return () => {
      active = false
    }
  }, [loadDetail, request.fileId])

  useEffect(() => {
    if (!selectedFileId) {
      setDiff(null)
      return
    }
    let active = true
    setDiff(null)
    setError(null)
    void requireSynapseBridge().agent.getFileCheckpointDiff({
      projectId,
      conversationId,
      checkpointId: request.checkpointId,
      fileId: selectedFileId,
    }).then((next) => {
      if (active) setDiff(next)
    }).catch((cause: unknown) => {
      if (active) setError(errorMessage(cause, "无法读取文件差异。"))
    })
    return () => {
      active = false
    }
  }, [conversationId, projectId, request.checkpointId, selectedFileId])

  const prepareRewind = useCallback(async () => {
    setPreparing(true)
    setError(null)
    try {
      const nextPrepared = await requireSynapseBridge().agent.prepareFileCheckpointRewind({
        projectId,
        conversationId,
        checkpointId: request.checkpointId,
      })
      preparedFileCountRef.current = nextPrepared.filesChanged.length
      setPrepared(nextPrepared)
    } catch (cause) {
      setError(errorMessage(cause, "无法准备撤销。"))
      try {
        setDetail(await loadDetail())
      } catch (refreshCause) {
        setError(errorMessage(refreshCause, errorMessage(cause, "无法准备撤销。")))
      }
    } finally {
      setPreparing(false)
    }
  }, [conversationId, loadDetail, projectId, request.checkpointId])

  useEffect(() => {
    if (request.action !== "rewind" || detail?.status !== "available") return
    const actionKey = `${request.checkpointId}:rewind`
    if (automaticActionRef.current === actionKey) return
    automaticActionRef.current = actionKey
    void prepareRewind()
  }, [detail?.status, prepareRewind, request.action, request.checkpointId])

  const confirmRewind = useCallback(async () => {
    if (!prepared) return
    setRewinding(true)
    setError(null)
    try {
      const result = await requireSynapseBridge().agent.confirmFileCheckpointRewind({
        projectId,
        conversationId,
        operationId: prepared.operationId,
      })
      setDetail((current) => current ? { ...current, status: result.status } : current)
      await onRewound()
    } catch (cause) {
      setError(errorMessage(cause, "撤销文件修改失败。"))
      try {
        setDetail(await loadDetail())
        await onRewound()
      } catch (refreshCause) {
        setError(errorMessage(refreshCause, errorMessage(cause, "撤销文件修改失败。")))
      }
    } finally {
      setPrepared(null)
      setRewinding(false)
    }
  }, [conversationId, loadDetail, onRewound, prepared, projectId])

  return {
    detail,
    selectedFileId,
    setSelectedFileId,
    diff,
    error,
    preparing,
    prepared,
    setPrepared,
    preparedFileCount: prepared?.filesChanged.length ?? preparedFileCountRef.current,
    rewinding,
    prepareRewind,
    confirmRewind,
  }
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim().length > 0 ? cause.message : fallback
}
