# Use explicit return for one strict JSON script result

Status: deprecated; replaced by accepted ADR-0204

Restricted JavaScript scripts run as async function bodies with one deeply copied and frozen strict-JSON `input` object, and only an explicit `return` produces the result. Each run yields exactly one strict JSON value: missing or non-serializable values fail, logs stay separate, and arrays or objects remain data rather than implicitly creating messages, ports, or fan-out.
