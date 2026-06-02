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
        headerKeys: ["Authorization"],
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
})
