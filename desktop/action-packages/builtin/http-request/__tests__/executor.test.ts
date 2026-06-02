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
        url: "https://example.com/api",
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
      resource: "https://example.com/api",
      context: expect.objectContaining({
        actionType: "builtin.http-request",
        method: "POST",
        headerKeys: ["Authorization"],
        timeoutMins: 2,
      }),
    }))
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
