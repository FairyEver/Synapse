# Fix Log

## 2026-05-16

| Agent | Iteration | Scope | Description |
|-------|-----------|-------|-------------|
| agent-1778925956-3618 | 1 | workflow-engine.ts: triggerSource propagation | Added `triggerSource` to all node-level logs (started/succeeded/failed/cancelled) and workflow terminal logs (failed/completed/cancelled) in `WorkflowEngine.run()` for single-step trigger correlation |
| agent-1778926571-5737 | 1 | workflow-dispatcher.ts: success log correlation | Added `dispatchCorrelation(params)` to MCP dispatch success log, matching existing start and error logs |
| agent-cc-sdk | 1 | workflow-scheduler.ts: eager skip propagation on failure | In `tryStart` failure handler, added `releaseSkippedDependency(next)` for each downstream of the failed node so the skip propagates eagerly through the DAG rather than waiting for the final cleanup loop |
