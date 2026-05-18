window.PANEL_DATA = {
  "lastUpdated": "2026-05-17T22:26:00+08:00",
  "startTime": "2026-05-17T14:56:00+08:00",
  "stats": {
    "totalRounds": 3,
    "totalFixes": 3,
    "totalScouts": 2,
    "totalConflicts": 0,
    "backlogOpen": 5,
    "backlogClaimed": 0,
    "backlogFixed": 1
  },
  "agents": [
    {
      "id": "agent-1779000983-6307",
      "iteration": 1,
      "status": "fixing",
      "direction": "A",
      "currentFile": "src/modules/workflow/hooks/use-workflow-list.ts",
      "lastAction": "removed setLoading(true) from refresh to prevent flash",
      "lastUpdated": "2026-05-17T14:56:00+08:00"
    },
    {
      "id": "agent-20260517-145615-k7m3",
      "iteration": 1,
      "status": "fixing",
      "direction": "A",
      "currentFile": "src/modules/workflow/hooks/use-workflow-run.ts",
      "lastAction": "removed dead useWorkflowRun hook",
      "lastUpdated": "2026-05-17T15:17:00+08:00"
    },
    {
      "id": "agent-1779001446-3468",
      "iteration": 1,
      "status": "scouting",
      "direction": "A",
      "currentFile": "src/app-shell/repository-manager.ts",
      "lastAction": "scouted workflow engine + nodes + IPC; fixed refreshRepositoryStates try-catch",
      "lastUpdated": "2026-05-17T22:26:00+08:00"
    }
  ],
  "directionStats": {
    "A": { "rounds": 2, "fixes": 2 },
    "B": { "rounds": 0, "fixes": 0 },
    "C": { "rounds": 0, "fixes": 0 },
    "D": { "rounds": 1, "fixes": 1 }
  },
  "typeStats": {
    "crash": 0,
    "errorHandling": 1,
    "deadCode": 1,
    "uiQuality": 0,
    "interaction": 1
  },
  "recentFixes": [
    {
      "time": "2026-05-17T14:56:00+08:00",
      "agentId": "agent-1779000983-6307",
      "iteration": 1,
      "priority": "P3",
      "type": "interaction",
      "summary": "remove setLoading(true) from refresh to prevent list flash on delete/external update",
      "files": ["src/modules/workflow/hooks/use-workflow-list.ts"],
      "userBenefit": "delete workflow no longer flashes loading spinner"
    },
    {
      "time": "2026-05-17T15:17:00+08:00",
      "agentId": "agent-20260517-145615-k7m3",
      "iteration": 1,
      "priority": "P2",
      "type": "deadCode",
      "summary": "removed dead useWorkflowRun hook (only used in test file)",
      "files": ["src/modules/workflow/hooks/use-workflow-run.ts", "src/modules/workflow/hooks/__tests__/use-workflow-run.test.tsx"],
      "userBenefit": "eliminated dead code, reduced maintenance burden"
    },
    {
      "time": "2026-05-17T22:26:00+08:00",
      "agentId": "agent-1779001446-3468",
      "iteration": 1,
      "priority": "P1",
      "type": "errorHandling",
      "summary": "added try-catch to refreshRepositoryStates to prevent unhandled rejection on IPC failure",
      "files": ["src/app-shell/repository-manager.ts"],
      "userBenefit": "repository state sync no longer produces unhandled promise rejections; UI preserves existing state on IPC error"
    }
  ],
  "backlog": [
    {"id":"issue-1779000983-a1b2","discoveredBy":"agent-1779000983-6307","summary":"渲染进程跨进程 import electron/services/error-sanitize","priority":"P2","status":"open"},
    {"id":"issue-1779000983-c3d4","discoveredBy":"agent-1779000983-6307","summary":"IPC 层 run/runDefinition/rerun 大量重复代码","priority":"P2","status":"open"},
    {"id":"issue-1779000983-e5f6","discoveredBy":"agent-1779000983-6307","summary":"WorkflowCard 删除后列表 loading 闪烁","priority":"P3","status":"open"},
    {"id":"issue-1779000983-g7h8","discoveredBy":"agent-1779000983-6307","summary":"switch 节点 defaultBranch 校验遗漏","priority":"P2","status":"open"},
    {"id":"issue-1779001487-s1e2","discoveredBy":"agent-1779001487-cce6","summary":"Switch 节点 validator 允许空 branches","priority":"P2","status":"open"},
    {"id":"issue-1779001487-s2e3","discoveredBy":"agent-1779001487-cce6","summary":"http-request 节点未对错误消息做 sanitize","priority":"P1","status":"open"},
    {"id":"issue-1779001487-s3e4","discoveredBy":"agent-1779001487-cce6","summary":"window-manager forceCloseAll 跳过 beforeunload","priority":"P1","status":"open"},
    {"id":"issue-1779001446-0001","discoveredBy":"agent-1779001446-3468","summary":"refreshPendingPushes 缺少 try-catch","priority":"P1","status":"open"},
    {"id":"issue-1779001446-0002","discoveredBy":"agent-1779001446-3468","summary":"refreshRepositoryStates 缺少 try-catch","priority":"P1","status":"fixed"},
    {"id":"issue-1779001446-0003","discoveredBy":"agent-1779001446-3468","summary":"node-config-panel.tsx 空 catch 块","priority":"P2","status":"open"}
  ],
  "timeline": [
    {
      "time": "2026-05-17T14:56:00+08:00",
      "agentId": "agent-1779000983-6307",
      "type": "scout",
      "event": "deep read workflow engine + UI layer",
      "detail": "4 issues logged to backlog, 1 fix applied"
    },
    {
      "time": "2026-05-17T15:17:00+08:00",
      "agentId": "agent-20260517-145615-k7m3",
      "type": "scout",
      "event": "deep read workflow direction A (engine + nodes + IPC + UI)",
      "detail": "added 1 backlog issue, removed dead useWorkflowRun hook"
    },
    {
      "time": "2026-05-17T22:26:00+08:00",
      "agentId": "agent-1779001446-3468",
      "type": "scout",
      "event": "scout A (workflow engine + nodes + IPC); fixed D (error handling in repository-manager.ts)",
      "detail": "read engine/scheduler/variable-resolver/all-4-node-executors/IPC; found 3 issues; fixed refreshRepositoryStates try-catch"
    }
  ]
};
