import { describe, expect, it, vi } from "vitest"

import { buildTencentAuthorization, createRecTask, describeTaskStatus, TencentAsrApiError } from "./tencent-asr"

/**
 * 这一层是照**真实返回**写的，不是照文档的直觉写的。
 *
 * 两个坑都是实测出来的：结果嵌在 `Data` 里而不是顶层；错误字段是大写的
 * `Code`/`Message`。两处猜错都不会报编译错，只会让整条链路静默失败——第一处表现为
 * 「取结果时报缺少 TaskId」，第二处表现为 `undefined: undefined`。
 */

const credentials = { secretId: "AKIDEXAMPLE", secretKey: "SECRET", region: "ap-guangzhou" }

function jsonFetch(body: unknown, status = 200) {
  // 签名与真实 fetch 一致，这样 `mock.calls` 里的请求参数才有类型。
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status }),
  )
}

describe("TC3 签名", () => {
  it("凭据范围按日期和服务切分", () => {
    const { authorization } = buildTencentAuthorization({
      credentials,
      action: "CreateRecTask",
      payload: "{}",
      timestampSeconds: 1_760_000_000,
    })
    expect(authorization).toContain("TC3-HMAC-SHA256 Credential=AKIDEXAMPLE/")
    expect(authorization).toContain("/asr/tc3_request")
    expect(authorization).toContain("SignedHeaders=content-type;host;x-tc-action")
  })

  it("同样的输入签出同样的结果，不同日期签出不同的结果", () => {
    const sign = (timestampSeconds: number) =>
      buildTencentAuthorization({ credentials, action: "CreateRecTask", payload: "{}", timestampSeconds }).authorization
    expect(sign(1_760_000_000)).toBe(sign(1_760_000_000))
    expect(sign(1_760_000_000)).not.toBe(sign(1_760_086_400))
  })
})

describe("提交任务", () => {
  it("任务号嵌在 Data 里，这里把它拍平", async () => {
    // 真实返回：{"RequestId":"…","Data":{"TaskId":16816512591}}
    const fetchImpl = jsonFetch({ Response: { RequestId: "req-1", Data: { TaskId: 16816512591 } } })
    const result = await createRecTask(
      {
        engineModelType: "16k_zh_en_meeting",
        channelNum: 1,
        resTextFormat: 1,
        sourceType: 0,
        url: "https://example.invalid/a.m4a",
        speakerDiarization: 1,
        speakerNumber: 0,
        filterDirty: 1,
        filterModal: 1,
        convertNumMode: 1,
      },
      credentials,
      { fetchImpl: fetchImpl as unknown as typeof fetch, nowMs: 1_760_000_000_000 },
    )
    expect(result).toEqual({ taskId: 16816512591 })
  })

  it("带上 Action 与版本号，并且把会议引擎的参数原样发出去", async () => {
    const fetchImpl = jsonFetch({ Response: { Data: { TaskId: 1 } } })
    await createRecTask(
      {
        engineModelType: "16k_zh_en_meeting",
        channelNum: 1,
        resTextFormat: 1,
        sourceType: 0,
        url: "https://example.invalid/a.m4a",
        speakerDiarization: 1,
        speakerNumber: 0,
        filterDirty: 1,
        filterModal: 1,
        convertNumMode: 1,
      },
      credentials,
      { fetchImpl: fetchImpl as unknown as typeof fetch, nowMs: 1_760_000_000_000 },
    )
    const init = fetchImpl.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)["X-TC-Action"]).toBe("CreateRecTask")
    expect((init.headers as Record<string, string>)["X-TC-Version"]).toBe("2019-06-14")
    expect(JSON.parse(String(init.body))).toMatchObject({
      EngineModelType: "16k_zh_en_meeting",
      ChannelNum: 1,
      SourceType: 0,
      SpeakerDiarization: 1,
      SpeakerNumber: 0,
      ResTextFormat: 1,
    })
  })

  it("热词为空时整个字段不发", async () => {
    // 发一个空串会被判参数错误，代价远大于少几个热词。
    const fetchImpl = jsonFetch({ Response: { Data: { TaskId: 1 } } })
    await createRecTask(
      {
        engineModelType: "16k_zh_en_meeting",
        channelNum: 1,
        resTextFormat: 1,
        sourceType: 0,
        url: "https://example.invalid/a.m4a",
        speakerDiarization: 1,
        speakerNumber: 0,
        filterDirty: 1,
        filterModal: 1,
        convertNumMode: 1,
        hotwordList: "",
      },
      credentials,
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    const body = JSON.parse(String((fetchImpl.mock.calls[0]?.[1] as RequestInit).body))
    expect(body).not.toHaveProperty("HotwordList")
  })
})

describe("取结果", () => {
  it("把 Data 拍平成调用方能直接读的字段", async () => {
    const fetchImpl = jsonFetch({
      Response: {
        RequestId: "req-2",
        Data: {
          TaskId: 42,
          Status: 2,
          StatusStr: "success",
          Result: "[0:0.000,0:2.090,0]  今天主要过三件事，\n",
          ResultDetail: [{ FinalSentence: "今天主要过三件事，", StartMs: 0, EndMs: 2090, SpeakerId: 0 }],
          ErrorMsg: "",
          AudioDuration: 16.8,
        },
      },
    })
    const result = await describeTaskStatus(42, credentials, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nowMs: 1_760_000_000_000,
    })
    expect(result).toMatchObject({
      taskId: 42,
      status: 2,
      statusText: "success",
      audioDuration: 16.8,
    })
    expect(result.detail).toHaveLength(1)
    expect(result.result).toContain("今天主要过三件事")
  })

  it("失败的返回也能读出原因", async () => {
    const fetchImpl = jsonFetch({
      Response: { Data: { TaskId: 42, Status: 3, StatusStr: "failed", ErrorMsg: "音频格式不支持" } },
    })
    const result = await describeTaskStatus(42, credentials, { fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(result.status).toBe(3)
    expect(result.errorMessage).toBe("音频格式不支持")
  })
})

describe("云端报错", () => {
  it("错误字段是大写的 Code / Message，不能按小写读", async () => {
    // 按小写读会得到一个 `undefined: undefined` 的报错，把真正的失败原因整个吞掉。
    const fetchImpl = jsonFetch({ Response: { Error: { Code: "MissingParameter", Message: "缺少 TaskId" } } })
    await expect(
      describeTaskStatus(42, credentials, { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(TencentAsrApiError)
    await expect(
      describeTaskStatus(42, credentials, { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow("MissingParameter: 缺少 TaskId")
  })

  it("HTTP 层失败也当作失败抛出", async () => {
    const fetchImpl = jsonFetch({}, 500)
    await expect(
      describeTaskStatus(42, credentials, { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow("HTTP 500")
  })
})
