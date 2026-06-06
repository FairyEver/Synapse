import { describe, expect, it, vi } from "vitest"

import { createHttpRequestAction } from "../executor.main"

describe("builtin.http-request executor", () => {
  it("builds request URL with query and stores response outputs", async () => {
    const sendRequest = vi.fn(async () => ({
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json" },
      body: "{\"ok\":true}",
    }))
    const action = createHttpRequestAction({ sendRequest })

    const result = await action.execute({
      config: {
        method: "GET",
        url: "https://example.com/api",
        query: { page: "1" },
        headers: { Authorization: "Bearer token" },
        bodyType: "none",
        timeoutMins: 1,
      },
      context: {
        taskId: "task:1",
        runId: "run:1",
        triggeredBy: "manual",
        cwd: "/tmp",
        actor: { kind: "user", id: "task-scheduler", display: "Task Scheduler" },
        abortSignal: new AbortController().signal,
      },
    })

    expect(sendRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      url: "https://example.com/api?page=1",
      headers: { Authorization: "Bearer token" },
      timeoutMs: 60_000,
      maxResponseBodyBytes: 5 * 1024 * 1024,
    }))
    expect(result).toEqual({
      status: "success",
      summary: "200 OK",
      logs: [{ label: "response", value: "{\"ok\":true}" }],
      outputs: {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        body: "{\"ok\":true}",
      },
      metrics: expect.objectContaining({ httpStatus: 200 }),
    })
  })

  it("adds JSON content-type and redacts sensitive response body content", async () => {
    const sendRequest = vi.fn(async () => ({
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        headers: {
          authorization: "Bearer e2e-bearer-secret",
          cookie: "sid=e2e-cookie-secret",
        },
        token: "sk-response-secret",
        file_path: "/Users/liyang/Documents/code/github/Synapse/plain.txt",
      }),
    }))
    const action = createHttpRequestAction({ sendRequest })

    const result = await action.execute({
      config: {
        method: "POST",
        url: "https://example.com/api",
        bodyType: "json",
        body: "{\"ok\":true}",
        auth: { type: "basic", basicUsername: "alice", basicPassword: "secret-password" },
      },
      context: {
        taskId: "task:1",
        runId: "run:1",
        triggeredBy: "manual",
        cwd: "/tmp",
        actor: { kind: "user", id: "task-scheduler", display: "Task Scheduler" },
        abortSignal: new AbortController().signal,
      },
    })

    expect(sendRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic YWxpY2U6c2VjcmV0LXBhc3N3b3Jk",
      },
      body: "{\"ok\":true}",
    }))
    expect(JSON.stringify(result)).not.toContain("e2e-bearer-secret")
    expect(JSON.stringify(result)).not.toContain("e2e-cookie-secret")
    expect(JSON.stringify(result)).not.toContain("sk-response-secret")
    expect(JSON.stringify(result)).not.toContain("YWxpY2U6c2VjcmV0LXBhc3N3b3Jk")
    expect(JSON.stringify(result)).toContain("/Users/liyang/Documents/code/github/Synapse/plain.txt")
  })

  it("fails before sending stale GET requests that still contain a body", async () => {
    const sendRequest = vi.fn()
    const action = createHttpRequestAction({ sendRequest })

    const result = await action.execute({
      config: {
        method: "GET",
        url: "https://example.com/api",
        bodyType: "text",
        body: "not allowed",
      },
      context: {
        taskId: "task:1",
        runId: "run:1",
        triggeredBy: "manual",
        cwd: "/tmp",
        actor: { kind: "user", id: "task-scheduler", display: "Task Scheduler" },
        abortSignal: new AbortController().signal,
      },
    })

    expect(result).toEqual(expect.objectContaining({
      status: "failed",
      error: "请求失败：GET 请求不支持 Body",
    }))
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it("builds network.connect permission context", () => {
    const action = createHttpRequestAction({ sendRequest: vi.fn() })
    const request = action.buildPermissionRequest({
      config: {
        method: "POST",
        url: "https://user:secret@example.com/api?token=sk-secret&query=ok",
        headers: { Authorization: "Bearer token" },
        bodyType: "json",
        body: "{\"ok\":true}",
        timeoutMins: 2,
      },
      context: {
        taskId: "task:1",
        runId: "run:1",
        triggeredBy: "schedule",
        cwd: "/tmp",
        actor: { kind: "user", id: "task-scheduler", display: "Task Scheduler" },
        abortSignal: new AbortController().signal,
      },
    })

    expect(request).toEqual(expect.objectContaining({
      action: "network.connect",
      resource: "https://%5Bredacted%5D:%5Bredacted%5D@example.com/api?token=%5Bredacted%5D&query=ok",
      context: expect.objectContaining({
        actionType: "builtin.http-request",
        method: "POST",
        url: "https://%5Bredacted%5D:%5Bredacted%5D@example.com/api?token=%5Bredacted%5D&query=ok",
        headerKeys: ["Authorization", "Content-Type"],
        timeoutMins: 2,
      }),
    }))
    expect(JSON.stringify(request)).not.toContain("user:secret")
    expect(JSON.stringify(request)).not.toContain("sk-secret")
  })

  it("includes built-in auth in permission context without exposing credentials", () => {
    const action = createHttpRequestAction({ sendRequest: vi.fn() })
    const context = {
      taskId: "task:1",
      runId: "run:1",
      triggeredBy: "schedule" as const,
      cwd: "/tmp",
      actor: { kind: "user" as const, id: "task-scheduler", display: "Task Scheduler" },
      abortSignal: new AbortController().signal,
    }

    const bearerRequest = action.buildPermissionRequest({
      config: {
        method: "GET",
        url: "https://example.com/api",
        headers: { "X-Trace": "trace-1" },
        bodyType: "none",
        auth: { type: "bearer", bearerToken: "sk-live-token" },
      },
      context,
    })
    const basicRequest = action.buildPermissionRequest({
      config: {
        method: "POST",
        url: "https://example.com/api",
        bodyType: "none",
        auth: { type: "basic", basicUsername: "alice", basicPassword: "secret-password" },
      },
      context,
    })

    expect(bearerRequest.context).toEqual(expect.objectContaining({
      authType: "bearer",
      headerKeys: ["Authorization", "X-Trace"],
    }))
    expect(basicRequest.context).toEqual(expect.objectContaining({
      authType: "basic",
      headerKeys: ["Authorization"],
    }))
    const serialized = JSON.stringify([bearerRequest, basicRequest])
    expect(serialized).not.toContain("sk-live-token")
    expect(serialized).not.toContain("alice")
    expect(serialized).not.toContain("secret-password")
    expect(serialized).not.toContain("Basic ")
    expect(serialized).not.toContain("Bearer ")
  })

  it("fails before sending when selected auth credentials are empty", async () => {
    const sendRequest = vi.fn(async () => ({
      status: 200,
      statusText: "OK",
      headers: {},
      body: "",
    }))
    const action = createHttpRequestAction({ sendRequest })
    const context = {
      taskId: "task:1",
      runId: "run:1",
      triggeredBy: "manual" as const,
      cwd: "/tmp",
      actor: { kind: "user" as const, id: "task-scheduler", display: "Task Scheduler" },
      abortSignal: new AbortController().signal,
    }

    await expect(action.execute({
      config: {
        method: "GET",
        url: "https://example.com/api",
        bodyType: "none",
        auth: { type: "bearer", bearerToken: "" },
      },
      context,
    })).resolves.toEqual(expect.objectContaining({
      status: "failed",
      error: "请求失败：Bearer Token 不能为空",
    }))

    await expect(action.execute({
      config: {
        method: "GET",
        url: "https://example.com/api",
        bodyType: "none",
        auth: { type: "basic", basicUsername: " " },
      },
      context,
    })).resolves.toEqual(expect.objectContaining({
      status: "failed",
      error: "请求失败：Basic Auth 用户名不能为空",
    }))

    expect(sendRequest).not.toHaveBeenCalled()
  })

  it("renders HTTP templates for url, query, headers, body, and auth", async () => {
    const sendRequest = vi.fn(async () => ({
      status: 200,
      statusText: "OK",
      headers: {},
      body: "",
    }))
    const action = createHttpRequestAction({ sendRequest })

    await action.execute({
      config: {
        method: "POST",
        url: "https://example.com/{{trigger.payload.team}}",
        query: { "{{trigger.payload.queryKey}}": "{{trigger.payload.queryValue}}" },
        headers: { "X-{{trigger.payload.headerKey}}": "{{trigger.payload.headerValue}}" },
        bodyType: "text",
        body: "issue={{trigger.payload.issue}}",
        auth: { type: "bearer", bearerToken: "{{trigger.payload.token}}" },
      },
      context: {
        taskId: "task:1",
        runId: "run:1",
        triggeredBy: "schedule",
        cwd: "/tmp",
        actor: { kind: "user", id: "automation" },
        abortSignal: new AbortController().signal,
        templateVariables: {
          "trigger.payload.team": "ops",
          "trigger.payload.queryKey": "id",
          "trigger.payload.queryValue": "42",
          "trigger.payload.headerKey": "Trace",
          "trigger.payload.headerValue": "abc",
          "trigger.payload.issue": "Bug",
          "trigger.payload.token": "secret-token",
        },
      },
    })

    expect(sendRequest).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://example.com/ops?id=42",
      headers: {
        "X-Trace": "abc",
        Authorization: "Bearer secret-token",
      },
      body: "issue=Bug",
    }))
  })

  it("reports unknown HTTP template variables before sending", async () => {
    const sendRequest = vi.fn()
    const action = createHttpRequestAction({ sendRequest })

    const result = await action.execute({
      config: {
        method: "GET",
        url: "https://example.com/{{trigger.payload.missing}}",
        bodyType: "none",
      },
      context: {
        taskId: "task:1",
        runId: "run:1",
        triggeredBy: "schedule",
        cwd: "/tmp",
        actor: { kind: "user", id: "automation" },
        abortSignal: new AbortController().signal,
        templateVariables: {},
      },
    })

    expect(result).toEqual(expect.objectContaining({
      status: "failed",
      error: "未知变量：trigger.payload.missing",
    }))
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it("does not expose rendered HTTP auth values in permission request", () => {
    const action = createHttpRequestAction({ sendRequest: vi.fn() })
    const request = action.buildPermissionRequest({
      config: {
        method: "GET",
        url: "https://example.com/api",
        bodyType: "none",
        auth: { type: "bearer", bearerToken: "{{trigger.payload.token}}" },
      },
      context: {
        taskId: "task:1",
        runId: "run:1",
        triggeredBy: "schedule",
        cwd: "/tmp",
        actor: { kind: "user", id: "automation" },
        abortSignal: new AbortController().signal,
        templateVariables: { "trigger.payload.token": "secret-token" },
      },
    })

    expect(JSON.stringify(request)).not.toContain("secret-token")
    expect(request.context).toEqual(expect.objectContaining({ authType: "bearer" }))
  })
})
