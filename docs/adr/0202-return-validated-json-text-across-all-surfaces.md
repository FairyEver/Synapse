# Return validated JSON text across all surfaces

JSON processing returns `{ json: string }` through the App and MCP, while its Workflow node uses the same `json` string as both primary output and structured output. The repaired text is authoritative after `JSON.parse` validation, and the parsed JavaScript value is never returned or serialized back over a boundary, because doing so would silently change large integer lexemes and other valid textual representations.
