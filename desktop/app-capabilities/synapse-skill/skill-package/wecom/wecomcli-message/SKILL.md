---
name: wecomcli-message
description: Use when 用户要求给企业微信/企微里的某人发消息、在某个群里通知、发给我、发到刚才那个群、查看能给谁发消息，或发送文本、Markdown、图片、文件、语音和视频；明确指定 Webhook 或已绑定 Webhook 的任务除外。
---

> **Synapse 执行入口**：下文所有 `wecom-cli ...` 都是参数规范。实际必须调用 `app_wecom_cli_run`，不得在终端或 Bash 中直接运行 `wecom-cli`，也不得自行登录、配置凭证或读取凭据文件。

# 企业微信发送消息

> 执行任何 `wecom-cli` 命令前，必须先读取并完成 `wecomcli-shared` 技能的公共前置检查。

可以向授权人本人，以及本次可发送会话列表中的其他单聊或群聊发送消息。查找某人以便发消息属于本 Skill，不需要通讯录能力。

## 按发送对象选择最短流程

完成公共连接检查后，按用户意图选择一个分支：

| 用户意图 | 目标来源与处理 |
|---|---|
| “现在能给谁发消息” | 调用一次 `sessions list`，按原顺序展示名称、单聊/群聊类型与接口返回时间；说明授权人本人也可发送。只有需要识别授权人时才调用 `identity whoami`。不发送消息。 |
| “企业微信发给我/本人” | `identity whoami` → 取授权真人用户 ID → 发送；无需查询会话列表。 |
| “给企业微信里的张三发消息” | `sessions list` → 只在 `chat_type=single` 中按姓名匹配 → 发送。 |
| “往机器人测试那个群聊发消息” | 提取名称“机器人测试”、类型 `group` → `sessions list` → 只在群聊中匹配 → 发送。 |
| “发到刚才那个群/发给他” | 根据上下文确定用户指代的对象 → 刷新 `sessions list` 并核验该对象 → 发送；不能用刷新后的第一项替代原目标。 |

目标或内容有歧义时只追问缺失项；用户已经明确要求发送且两者完整时直接执行。“随便发一句”“发个顺口溜”授权生成对应内容，无需再索要逐字正文。

目标不是授权人且不在本次列表中时停止发送，说明当前列表中未找到该对象；不推断对方不存在或确定没有近期消息，也不改用 Webhook。

## 消息媒体上传

发送图片、文件、语音或视频时，若没有可直接复用的 `media_id`，在目标会话匹配成功后上传本地文件。先按 `wecomcli-shared` 的文件规则将用户文件复制到工具返回的 `workingDirectory`，再通过 `app_wecom_cli_run` 执行以下参数规范：

```bash
wecom-cli media upload --json '{"file_path":"<workingDirectory>/example.png"}'
```

`file_path` 是必填的真实本地文件路径。返回的 `media_id`、`type`、`created_at` 分别为媒体标识、媒体类型和创建时间；将真实返回的 `media_id` 用于后续消息。返回的 `type` 必须与发送时的 `msg_type` 一致（`image` / `file` / `voice` / `video`），不匹配时停止发送并说明原因。

已有可复用且类型匹配的 `media_id` 时直接使用，不重复上传。仅保留消息所需的上传，不提供独立媒体下载或文件内容解析。

## 获取能发送消息的会话列表

### 命令

通过 `app_wecom_cli_run` 执行 `wecom-cli message aibot sessions list`，直接传：

```json
{"args":["message","aibot","sessions","list"]}
```

### 返回

| 字段 | 类型 | 说明 |
|---|---|---|
| `sessions` | array | 会话列表，按最后一条消息时间从新到旧排序，具体数量以实际回包为准 |
| `sessions[].chat_id` | string | 会话 ID |
| `sessions[].chat_name` | string | 群名称或单聊名称 |
| `sessions[].chat_type` | string | `single` 单聊或 `group` 群聊 |
| `sessions[].last_msg_time` | string | 最后一条消息时间，格式 `YYYY-MM-DD HH:MM:SS` |
| `sessions_count` | integer | `sessions` 数组元素数量 |

名称为空时显示“未命名群聊/未命名单聊”及接口返回时间，不虚构名称。`last_msg_time` 只代表接口返回的会话时间，不能据此推断本次发送的时间或是否送达。

### `chat_id` 来源

向授权人以外的用户发送消息，调用 `wecom-cli message aibot send` 前，需要先调用一次 `sessions list`，然后从本次返回的 `sessions[]` 中选定目标项，把该项的 `chat_id` 原样复制到 `send.chat_id`。

以下值都不能直接作为 `send.chat_id`：

- 用户输入的 ID
- 之前轮次或历史上下文保存的 `chat_id`
- 通讯录返回的 `userid`
- 根据姓名、群名或其他字段自行构造的值

这些值最多只能作为匹配线索；最终发送参数必须重新取自本次 `sessions list` 的匹配项。

### 目标会话匹配

- **聊天名称**：先从用户话语中提取实际名称与明确的单聊/群聊类型，再按非空 `chat_name` 精确匹配；“那个群聊”等称呼不是群名的一部分，不随意删改实际名称中的“群”字。指定群聊时只匹配 `group`，指定个人时只匹配 `single`；未指定类型且同名跨类型时让用户选择。非精确匹配只能作为候选供用户确认，不自动发送。
- **上下文指代**：历史会话 ID 只能用来核验新列表中的同一个对象，不直接作为发送参数。用户指向刚展示的唯一未命名群聊时可继续；多项均符合“那个群/他”时询问。刷新后只看原对象是否仍在，不按变化后的排序替换对象；改名后使用新列表中的名称。
- **最近第一个/最近某个会话**：按 `sessions[]` 原始顺序选择用户明确指定的项。
- **用户提供 ID**：只能与本次 `sessions[].chat_id` 做完全相等校验；命中后仍从匹配项复制 `chat_id`，不能直接复用用户输入值。

匹配结果处理：

- 唯一匹配时继续发送。
- 多个聊天会话候选时，按返回顺序展示聊天名和最后消息时间，让用户选择。
- 用户完成选择后，必须重新调用 `sessions list`，再用选定对象匹配当次返回值。
- 无匹配时停止发送，如实告知当前可发送会话列表中未找到目标，数量以实际回包为准；不要接受外部 `chat_id` 绕过限制。
- `sessions_count=0` 时告知当前没有返回最近会话，停止向其他对象发送；授权人本人仍可走 `identity whoami` 分支。
- 展示会话列表时保持接口原始顺序；展示名称和时间，不展示内部 `chat_id`。

## 发送消息

### 前置条件

调用本接口前必须完成以下步骤：

1. 本人分支：调用 `wecom-cli identity whoami`，取授权真人用户 ID 作为 `chat_id`，无需列表匹配。
2. 其他对象分支：调用 `wecom-cli message aibot sessions list`，按类型、名称或明确的上下文指代唯一匹配目标，从匹配项原样复制 `sessions[].chat_id`。
3. 目标是媒体消息时，再准备对应的 `media_id`。

在目标会话匹配成功前，不上传媒体，也不调用 `send`。

### 命令

通过 `app_wecom_cli_run` 执行 `wecom-cli message aibot send --json '<JSON 参数>'`。普通文本也使用 Markdown，直接传以下结构，将目标和内容替换为本次真实值：

```json
{"args":["message","aibot","send","--json","{\"chat_id\":\"<本次目标>\",\"msg_type\":\"markdown\",\"markdown\":{\"content\":\"<消息内容>\"}}"]}
```

`--json` 后是一个完整 JSON 字符串参数，不带 shell 外层单引号。已知的消息流程不需要先调用 `schema`。

### 公共参数

| 字段 | 类型 | 必填 | 说明 |
|---|---|:---:|---|
| `chat_id` | string | 是 | 必须取自 `wecom-cli identity whoami` 或当前发送流程中刚调用的 `sessions list` 返回的目标 `sessions[].chat_id` |
| `msg_type` | string | 是 | `markdown` / `image` / `file` / `voice` / `video` |
| `markdown` | object | 条件必填 | 仅 `msg_type="markdown"` 时传 |
| `image` | object | 条件必填 | 仅 `msg_type="image"` 时传 |
| `file` | object | 条件必填 | 仅 `msg_type="file"` 时传 |
| `voice` | object | 条件必填 | 仅 `msg_type="voice"` 时传 |
| `video` | object | 条件必填 | 仅 `msg_type="video"` 时传 |

每次请求必须且只能携带一个与 `msg_type` 同名的内容对象。不要传空对象，也不要同时传多个消息对象。

### Markdown 消息

`markdown.content` 必填，最长 20480 UTF-8 字节。普通文本也按 Markdown 发送。

```bash
wecom-cli message aibot send --json '{
  "chat_id": "<本次 sessions[].chat_id>",
  "msg_type": "markdown",
  "markdown": {
    "content": "<markdown 消息内容>"
  }
}'
```

### 图片消息

`image.media_id` 必填，必须由媒体上传接口以 `type=image` 上传获得。

```bash
wecom-cli message aibot send --json '{
  "chat_id": "<本次 sessions[].chat_id>",
  "msg_type": "image",
  "image": {
    "media_id": "<media_id>"
  }
}'
```

### 文件消息

`file.media_id` 必填，必须由媒体上传接口以 `type=file` 上传获得；文件名取上传时的原始文件名。

```bash
wecom-cli message aibot send --json '{
  "chat_id": "<本次 sessions[].chat_id>",
  "msg_type": "file",
  "file": {
    "media_id": "<media_id>"
  }
}'
```

### 语音消息

`voice.media_id` 必填，必须由媒体上传接口以 `type=voice` 上传获得；源文件仅支持 AMR 格式，不能只改扩展名冒充 AMR。

```bash
wecom-cli message aibot send --json '{
  "chat_id": "<本次 sessions[].chat_id>",
  "msg_type": "voice",
  "voice": {
    "media_id": "<media_id>"
  }
}'
```

### 视频消息

| 字段 | 必填 | 说明 |
|---|:---:|---|
| `video.media_id` | 是 | 由媒体上传接口以 `type=video` 上传获得 |
| `video.title` | 否 | 最长 128 UTF-8 字节；省略时使用上传时的原始文件名 |
| `video.description` | 否 | 最长 512 UTF-8 字节；省略时不展示描述 |

```bash
wecom-cli message aibot send --json '{
  "chat_id": "<本次 sessions[].chat_id>",
  "msg_type": "video",
  "video": {
    "media_id": "<media_id>",
    "title": "产品演示",
    "description": "本周版本的核心功能演示"
  }
}'
```

用户没有提供视频标题或描述时直接省略对应字段，不传空字符串，也不追问非必填字段。

## 关键约束

- 用户明确要求发送且目标与内容完整时直接执行，不重复追问确认；缺少目标、内容或本地文件时只追问缺失项。
- 连续发送多条时，不用每次 `send` 前都重新调用 `sessions list` 或 `wecom-cli identity whoami`，但连续发送中途上下文发生压缩时重新调用确保 `chat_id` 正确。
- `chat_id`、`userid`、`media_id` 都是内部调用值，禁止面向用户展示。
- Markdown 正文、视频标题和描述限制按 UTF-8 字节数计算；超限时不静默截断，请用户缩短或明确同意拆分。
- 仅在 `output.success=true` 时报告已发送，简短说明目标和消息类型；不把发送成功解释为对方已读，不编造消息 ID，不主动询问是否重发或换人再发，也不重复整段正文，除非用户要求。
- 接口失败时说明用户可理解的原因和下一步，不使用 curl / Python 等方式绕过 `wecom-cli`。结果不明确时不自动重发，避免重复消息。
