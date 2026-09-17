import { describe, expect, it } from "vitest"

import {
  ASR_SIGNATURE_TTL_SECONDS,
  buildSignatureSource,
  normalizeHotwordList,
  percentEncode,
  signAsrSession,
  type AsrCredentials,
} from "./asr-signature"

const credentials: AsrCredentials = {
  appId: "1252371654",
  secretId: "AKIDzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
  secretKey: "SECRETKEYzzzzzzzzzzzzzzzzzzzzzzzz",
}

/** 固定时间与 nonce，让签名可复现。 */
const FIXED = { nowMs: 1_700_000_000_000, nonce: 123_456_789 }

describe("percentEncode", () => {
  it("编码 base64 里必然出现的 + 和 =", () => {
    expect(percentEncode("AK+8I3HCUkjpEP9Ty3kYuktEEtU=")).toBe("AK%2B8I3HCUkjpEP9Ty3kYuktEEtU%3D")
  })

  it("切掉 encodeURIComponent 不处理的那几个字符", () => {
    expect(percentEncode("!'()*")).toBe("%21%27%28%29%2A")
  })
})

describe("buildSignatureSource", () => {
  it("按字典序排序且不带协议", () => {
    const source = buildSignatureSource("1252371654", {
      voice_id: "v",
      expired: "2",
      secretid: "s",
      timestamp: "1",
    })
    expect(source).toBe("asr.cloud.tencent.com/asr/v2/1252371654?expired=2&secretid=s&timestamp=1&voice_id=v")
  })

  it("不把 signature 自身算进签名原文", () => {
    expect(buildSignatureSource("1", { a: "1", signature: "ignored" }))
      .toBe("asr.cloud.tencent.com/asr/v2/1?a=1")
  })
})

describe("signAsrSession", () => {
  const request = {
    engineModelType: "16k_zh_en_2.0",
    voiceId: "00000000-0000-4000-8000-000000000003",
    hotwordList: "SynapseMobile|10,devicectl|10,mobile-gateway|10",
    domain: 1,
  }

  /** 原始 base64 恰好同时含 `+` 和 `=`，任何一步漏编码都会被抓到。 */
  const GOLDEN_SIGNATURE = "maQdxR6c40+4EvVlOHnQiDe0sfQ="

  /**
   * 黄金用例：期望值由独立的 Python 实现（hmac/hashlib/quote）算出，不是本模块的
   * 自证。签名原文与编码结果都逐字比对。
   */
  it("复现官方算法的黄金用例", () => {
    expect(buildSignatureSource(credentials.appId, {
      domain: "1",
      engine_model_type: "16k_zh_en_2.0",
      expired: "1700000300",
      hotword_list: "SynapseMobile|10,devicectl|10,mobile-gateway|10",
      needvad: "1",
      nonce: "123456789",
      secretid: credentials.secretId,
      timestamp: "1700000000",
      voice_format: "1",
      voice_id: "00000000-0000-4000-8000-000000000003",
    })).toBe(
      "asr.cloud.tencent.com/asr/v2/1252371654?domain=1&engine_model_type=16k_zh_en_2.0&expired=1700000300" +
        "&hotword_list=SynapseMobile|10,devicectl|10,mobile-gateway|10&needvad=1&nonce=123456789" +
        "&secretid=AKIDzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz&timestamp=1700000000&voice_format=1" +
        "&voice_id=00000000-0000-4000-8000-000000000003",
    )

    const signed = signAsrSession(credentials, request, FIXED)
    expect(signed.url).toContain("signature=maQdxR6c40%2B4EvVlOHnQiDe0sfQ%3D")
  })

  /**
   * 反证：把 urlencode 那一步去掉，上面断言必须变红。这里断言的是"原始 base64
   * 不出现在 URL 里"——它恰好同时含 `+` 和 `=`。
   */
  it("签名里不含未编码的 + 或 =", () => {
    const signed = signAsrSession(credentials, request, FIXED)
    expect(new URL(signed.url).searchParams.get("signature")).toBe(GOLDEN_SIGNATURE)
    expect(signed.url).not.toContain(`signature=${GOLDEN_SIGNATURE}`)
    expect(signed.url.split("signature=")[1]).not.toMatch(/[+=]/u)
  })

  /**
   * 反证：把上面 `.map` 里的 `percentEncode` 去掉，这条必须变红。
   *
   * 热词表里的空格和 `|` 曾经是裸着拼进 URL 的。Foundation 只要发现串里有非法
   * 字符，就会把**整条 query** 重编一遍——连已经转义好的 signature 一起，
   * `%2F` 变成 `%252F`。腾讯云解码后对不上，判签名错误 4002；iOS 那边握手失败，
   * 界面显示成「网络已断开」。Node 容忍畸形 URL，所以只有 Apple 端会踩。
   */
  it("URL 里不留裸字符，否则严格解析的客户端会把签名二次转义", () => {
    const signed = signAsrSession(
      credentials,
      { ...request, hotwordList: "git status|10,Synapse|8" },
      FIXED,
    )
    const query = signed.url.slice(signed.url.indexOf("?") + 1)
    // RFC 3986 的 query 允许集。空格和 | 都不在里面。
    expect(query).toMatch(/^[A-Za-z0-9\-._~!$&'()*+,;=:@\/?%]*$/)
    // 转义之后值还得能原样解回来，别把热词表改坏。
    expect(new URL(signed.url).searchParams.get("hotword_list")).toBe("git status|10,Synapse|8")
  })

  it("时间戳与有效期按秒，有效期 5 分钟", () => {
    const signed = signAsrSession(credentials, request, FIXED)
    const params = new URL(signed.url).searchParams
    expect(params.get("timestamp")).toBe("1700000000")
    expect(params.get("expired")).toBe("1700000300")
    expect(signed.expiredAt).toBe(1_700_000_300)
    expect(ASR_SIGNATURE_TTL_SECONDS).toBe(300)
  })

  it("地址、协议与 appid 拼在路径上", () => {
    const signed = signAsrSession(credentials, request, FIXED)
    expect(signed.url.startsWith("wss://asr.cloud.tencent.com/asr/v2/1252371654?")).toBe(true)
    expect(signed.voiceId).toBe(request.voiceId)
  })

  it("没有热词时不下发 hotword_list", () => {
    const signed = signAsrSession(credentials, { ...request, hotwordList: undefined }, FIXED)
    expect(new URL(signed.url).searchParams.has("hotword_list")).toBe(false)
  })

  it("密钥本身不出现在 URL 里，只有 secretid", () => {
    const signed = signAsrSession(credentials, request, FIXED)
    expect(signed.url).not.toContain(credentials.secretKey)
    expect(signed.url).toContain("secretid=AKIDzzzz")
  })
})

describe("normalizeHotwordList", () => {
  it("丢掉空项、只有权重的残项和超长项", () => {
    expect(normalizeHotwordList(" SynapseMobile|10 , ,|10,b|2,")).toBe("SynapseMobile|10,b|2")
    expect(normalizeHotwordList(`a|1,${"x".repeat(31)}|1`)).toBe("a|1")
  })

  it("按 128 条截断", () => {
    const raw = Array.from({ length: 200 }, (_, index) => `w${index}|1`).join(",")
    expect(normalizeHotwordList(raw).split(",")).toHaveLength(128)
  })

  it("空串与 undefined 都返回空", () => {
    expect(normalizeHotwordList("")).toBe("")
    expect(normalizeHotwordList(undefined)).toBe("")
  })
})
