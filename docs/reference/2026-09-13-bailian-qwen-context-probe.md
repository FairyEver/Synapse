# 百炼 Qwen 上下文与请求体边界实测

日期：2026-09-13。状态：**真实 API 边界测试完成；不代表 Synapse 图片恢复或长任务验收通过**。

本次用户明确授权使用 Synapse 已配置的“百炼”Provider 测试接口容量。直接调用配置中的 `qwen3.8-max` 和 `https://dashscope.aliyuncs.com/apps/anthropic/v1/messages`，不经过 Synapse 的 SDK、上下文 governor、工具定义或历史恢复。输入全部为合成文本，未发送真实对话、业务日志、图片或用户文件。共 13 次请求；后续复测属于新的计费请求，不能因阅读本文件自动执行。

逐请求脱敏数据见[实测记录 JSON](2026-09-13-bailian-qwen-context-probe-results.json)。记录保留数值、响应模型、usage、停止原因及错误，移除了凭据、Provider 私有身份、原始响应、请求 ID 和本机路径。未将读取本机凭据的临时测试脚本纳入仓库。

## 1. 可复用结论

| 维度 | 边界成功 | 越界失败 | 证据 |
| --- | ---: | ---: | --- |
| 关闭思考：最大输入 | 991,808 token | 991,809 token | T07/T08；成功响应 `end_turn`、正文 `OK` |
| 开启思考：最大输入 | 983,616 token | 983,617 token | T12/T13；成功响应有 `message_stop` |
| HTTP 请求体 | 6,291,456 字节，即 6 MiB | 6,291,457 字节 | T05/T03；HTTP 200 / HTTP 400 |

两个输入边界成功请求分别报告总输入 991,808 和 983,616 token；不是只根据“HTTP 请求已发出”判断成功。越界请求不返回 usage，其 token 数由同一填充序列的校准关系得到。

服务端返回：

```text
关闭思考：InvalidParameter — Range of input length should be [1, 991808]
开启思考：InvalidParameter — Range of input length should be [1, 983616]
请求体：BadRequest.TooLarge — Exceeded limit on max bytes to request body : 6291456
```

官方总上下文窗口为 **1,000,000 token**；这是输入与输出共同受约束的窗口，不是本次验证的最大输入值。输出、思考和最大输入不能取各自独立最大值后相加。开启思考的输入上限比关闭思考少 8,192 token；不能把这个差值解释为用户可任意调整或必然实际消耗的思考长度。

**token 与字节必须同时满足限制。** 图片 Base64、JSON 转义、系统提示、工具定义、消息和结果封装都占用请求体字节；视觉 token 不等于 Base64 字符数。6 MiB 是完整请求体上限，不是单张图片原文件上限，也不是全部会话历史的累计上限。

## 2. 测试参数与可重复方法

认证使用配置对应凭据，在进程内放入 `Authorization: Bearer …`，请求头为 `Content-Type: application/json`、`anthropic-version: 2023-06-01`。禁止把真实认证值写进此文档、脚本常量、命令行或结果记录。复测前按现有授权途径注入凭据，并核对端点及精确模型；不自动搜索其它账号或替换模型。

以下是完整合成请求构造方法，**仅构造数据，不发送请求**：

```js
function makePayload(fillerUnits, thinking = "disabled", stream = true) {
  return {
    model: "qwen3.8-max",
    max_tokens: 16,
    stream,
    thinking: { type: thinking },
    messages: [{
      role: "user",
      content: "Synthetic API capacity test. Ignore the filler and reply only OK.\nFILLER:"
        + " a".repeat(fillerUnits)
        + "\nEND. Reply only OK.",
    }],
    ...(thinking === "enabled" ? { output_config: { effort: "low" } } : {}),
  }
}

const body = JSON.stringify(makePayload(991770))
const requestBytes = Buffer.byteLength(body, "utf8")
```

请求体使用 `JSON.stringify` 紧凑编码，固定 `max_tokens=16`，避免为测输入容量生成大量输出。采用 Node.js 22.22.3 内置 `fetch`，每次总超时 240 秒，禁止重定向；没有配置自动重试。流式请求必须完整读到 `message_stop`，合并 `message_start.message.usage` 与 `message_delta.usage`，同时检查 SSE error，不能只以 HTTP 200 判断通过。

### 2.1 token 校准与边界

1. 关闭思考、非流式，`fillerUnits=1024`：服务端总输入 1,062 token，模板开销为 38；`fillerUnits=200000`：总输入 200,038，校准关系保持一致。
2. 关闭思考、流式，`fillerUnits=991770`：实际总输入 991,808，完整返回；`991771` 被拒绝。另一次 `1000000` 填充单位也被拒绝。
3. 开启思考、流式，`fillerUnits=1024`：总输入 1,099，模板开销为 75。模式改变会影响模板开销，不能继续使用 38。
4. 开启思考、流式，`fillerUnits=983541`：总输入 983,616，完整返回；`983542` 被拒绝。校准前的 `983579`、`983578` 两次探测也被拒绝，保留在记录中，不伪装成边界成功或网络失败。
5. 本次填充序列中每个 `" a"` 增加一个 token；这是服务端响应校准所得，不可推广到中文、随机字符串、JSON 或图片。

总输入按以下方式计算：

```text
totalInputTokens = input_tokens
                + cache_read_input_tokens
                + cache_creation_input_tokens
```

`prompt_tokens_details.cached_tokens` 是缓存明细，不再重复相加。缓存命中减少费用或处理工作，不减少上下文占用。

### 2.2 字节边界与 token 隔离

对 `makePayload(0, "disabled", false)` 的紧凑 JSON 追加合法尾部 ASCII 空格，分别补足到 6,291,456 和 6,291,457 字节。两者语义完全相同，成功请求仅有 38 个输入 token。这隔离了原始 HTTP body 大小与模型 token 限制；没有靠先超过模型输入窗口来推断 6 MiB。

```js
const smallBody = JSON.stringify(makePayload(0, "disabled", false))
const targetBytes = 6 * 1024 * 1024
const exactBody = smallBody + " ".repeat(targetBytes - Buffer.byteLength(smallBody))
const overBody = exactBody + " "
```

空间填充只用于容量测试，不是生产规避方式。改用图片、不同字段或其它协议后的单项限制仍需分别验证。

## 3. 成功请求的数值证据

| 请求 | body 字节 | input_tokens | cache_read_input_tokens | 总输入 token | 输出 token | 耗时 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 关闭思考边界 T07 | 1,983,761 | 792,128 | 199,680 | 991,808 | 1 | 58.658 秒 |
| 开启思考边界 T12 | 1,967,335 | 982,592 | 1,024 | 983,616 | 16 | 81.281 秒 |
| body 边界 T05 | 6,291,456 | 38 | 0 | 38 | 2 | 0.966 秒 |

这三次 `cache_creation_input_tokens=0`。开启思考边界的 16 个输出 token 用于思考，最终 `stop_reason=max_tokens`、可见正文为空；这是输出额度用完后的正常结束，证明输入被接收并启动生成，不证明完成了用户语义任务。关闭思考的 token 边界输出 `OK`，body 边界输出 `OK.`。

T04 是约 980,038 token 的非流式请求，20.084 秒后出现 `TypeError`，没有保存到 HTTP 状态或底层 cause。原因未知，不能定性为 Provider 容量、超时策略或网络故障；随后更大流式请求成功，不能用 T04 下调最大输入。以上耗时是单次观测，不是延迟 SLA。

## 4. 对 Synapse 的含义与禁止外推

- 模型目录继续区分总窗口和思考模式下最大输入；不要将其改成 200K、5 MiB 或 6 MiB。
- Synapse 的 200K 自动整理配置窗口和 5 MiB 安全预算是本地运行策略，不是百炼最大输入。测试没有授权修改这些配置。
- 本次直接请求的 body 字节是实测值；生产 SDK 请求账本仍是估算，不能把两者混称为精确 HTTP 观测。
- 本次没有调用原生 SDK 图片 Read，也没有取得原失败请求的完整出站 body；不能证明原图触发了百炼 6 MiB 拒绝，更不能证明图片可以重呈现。
- 没有测最大输出、所有思考力度、工具/图片/视频配额、多轮质量或所有百炼地域/模型/端点。结论只针对本次精确端点、模型及参数。
- 不能把脚本全量扫描、成功 token 计数或返回 `OK` 当作全文理解、逐张视觉检查、任务完成或“无限对话”验收。

结合本次监视报错的分析与实施顺序见[持续对话方案](../superpowers/plans/2026-09-13-bailian-context-and-continuous-conversation-plan.md)。

## 5. 官方依据

- [qwen3.8-max 模型能力与上下文限制](https://help.aliyun.com/zh/model-studio/qwen3-8-max)，本次测试前核对；总窗口 1,000,000，最大输入 991,808，思考模式最大输入 983,616。
- [Anthropic 兼容 Messages API](https://help.aliyun.com/zh/model-studio/anthropic-api-messages)，本次测试前核对参数与响应格式。

官方页面和模型别名可能更新；复测必须记录日期、精确模型、端点、参数、缓存用量和完整终态，不能只复制本表数字。
