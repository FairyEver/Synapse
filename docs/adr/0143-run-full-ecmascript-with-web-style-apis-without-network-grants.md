# Run full ECMAScript with Web-style APIs without network grants

Status: deprecated; replaced by accepted ADR-0204

JavaScript 运行 is a versioned, complete ECMAScript environment with a reasonable cross-platform Web-style host API. Ordinary dynamic-language features such as `eval` and `Function`, and network access to targets reachable from the current machine, are product capabilities rather than exceptional permissions. Workflow and Automation configurations do not declare network origins, methods, private-address exceptions, or per-request grants, and fetch does not call `PermissionGuard` for each target.

The JavaScript environment remains distinct from Node.js execution by exposing no DOM or UI, Electron, Node.js globals, `process`, `require`, or local-file API. Its implementation must prevent ordinary guest code from reaching Node.js or Electron through host bridges, prototypes, constructors, or transferred host objects, while avoiding an absolute hostile-code sandbox claim.

Timeouts, cancellation, one-shot execution units, memory and stack protection, source, input, result, log and IPC bounds, and concurrency limits exist only to protect Synapse stability. They must not be presented as user resource permissions or used to reconstruct the removed network-grant model.

This decision supersedes ADR 0133's minimal brokered Web API and per-target authorization direction. The exact V1 Web API table and execution engine remain separate decisions.
