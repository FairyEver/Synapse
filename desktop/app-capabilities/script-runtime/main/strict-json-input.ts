import { types } from "node:util"

import {
  SCRIPT_INPUT_MAX_BYTES,
  type JsonObject,
  type JsonValue,
  ScriptRuntimeError,
  serializeStrictJsonObjectWithProxyDetector,
  serializeStrictJsonValueWithProxyDetector,
} from "../shared/json"

const INVALID_SCRIPT_INPUT_MESSAGE = "Script input could not be resolved."

export function snapshotStrictJsonObject(value: unknown): JsonObject {
  try {
    return JSON.parse(
      serializeStrictJsonObjectWithProxyDetector(value, "Script input", types.isProxy),
    ) as JsonObject
  } catch {
    throw new ScriptRuntimeError("INVALID_INPUT", INVALID_SCRIPT_INPUT_MESSAGE)
  }
}

export function snapshotStrictJsonValue(value: unknown): JsonValue {
  try {
    return JSON.parse(
      serializeStrictJsonValueWithProxyDetector(value, "Script input", types.isProxy),
    ) as JsonValue
  } catch {
    throw new ScriptRuntimeError("INVALID_INPUT", INVALID_SCRIPT_INPUT_MESSAGE)
  }
}

export function serializeScriptInput(input: unknown): string {
  let serialized: string
  try {
    serialized = serializeStrictJsonObjectWithProxyDetector(
      input,
      "Script input",
      types.isProxy,
    )
  } catch {
    throw new ScriptRuntimeError("INVALID_INPUT", "Script input must be a strict JSON object.")
  }
  if (Buffer.byteLength(serialized, "utf8") > SCRIPT_INPUT_MAX_BYTES) {
    throw new ScriptRuntimeError("INVALID_INPUT", "Script input is too large.")
  }
  return serialized
}
