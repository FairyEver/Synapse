import { useCallback, useMemo, useRef, useState } from "react"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { startTrackedOperation } from "../../../src/lib/ui-tracking"
import {
  createJsonRepairErrorPayload,
  type JsonRepairErrorPayload,
} from "../shared/errors"
import {
  JSON_REPAIR_INPUT_MAX_BYTES,
  utf8ByteLength,
} from "../shared/schema"

const logger = createRendererLogger("json-repair.app")

type JsonRepairUiState = {
  readonly busy: boolean
  readonly error: JsonRepairErrorPayload | null
  readonly json: string | null
}

const EMPTY_STATE: JsonRepairUiState = {
  busy: false,
  error: null,
  json: null,
}

export function useJsonRepair() {
  const bridge = useMemo(() => requireBridgeDomain("jsonRepair"), [])
  const [text, setTextState] = useState("")
  const [state, setState] = useState<JsonRepairUiState>(EMPTY_STATE)
  const revisionRef = useRef(0)
  const inputBytes = utf8ByteLength(text)
  const canRepair = text.trim().length > 0
    && inputBytes <= JSON_REPAIR_INPUT_MAX_BYTES
    && !state.busy

  const setText = useCallback((value: string) => {
    revisionRef.current += 1
    setTextState(value)
    setState(EMPTY_STATE)
  }, [])

  const repair = useCallback(async () => {
    if (!canRepair) return
    const finishTracking = startTrackedOperation({ component: "json-repair", eventKey: "json-repair.text.repair" })
    const revision = revisionRef.current
    setState({ busy: true, error: null, json: null })
    try {
      const response = await bridge.text.repair({ text })
      finishTracking(response.ok ? "success" : "failure")
      if (revision !== revisionRef.current) return
      setState(response.ok
        ? { busy: false, error: null, json: response.result.json }
        : { busy: false, error: response.error, json: null })
    } catch {
      finishTracking("failure")
      logger.error("JSON repair IPC failed.")
      if (revision === revisionRef.current) {
        setState({
          busy: false,
          error: createJsonRepairErrorPayload("INTERNAL_ERROR"),
          json: null,
        })
      }
    }
  }, [bridge, canRepair, text])

  return {
    text,
    setText,
    inputBytes,
    canRepair,
    busy: state.busy,
    error: state.error,
    json: state.json,
    repair,
  }
}
