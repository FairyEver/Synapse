# base-upload：AI 使用契约

2026-09-22 范围：5 个已注册且接入执行层的基础能力。基础上下文不是 Portal 菜单页面，不计入页面覆盖数。

权威定义：`src/catalog/contracts-base.ts`。SDK 通过 `catalog.describe(id).ai` 返回以下业务契约，`returns.fields` 和 `params[].contract` 同源；执行入口由 `describe(id).invoke` 返回。通用调用为 `sdk.capabilities.invoke(id, args)`。以下内容从同一契约生成，避免另一套手写参数/返回说明。

证据：对应能力实现、`test/base-upload.test.ts` 的历史真机形状夹具；历史只读/OSS验收详见 `docs/base/`。本轮为离线语义验证，没有重放真实写入。

## base-upload-file

将本地文件字节上传 OSS，设为公共读并返回业务表单可引用的 URL。

- 场景：流程附件、图片等业务需要文件URL时；上传本身不会提交业务表单。
- 性质：write
- 边界：会实际 PUT 文件并 PUT public-read ACL，然后 GET ACL 复核；没有流程式 prepare→submit 事务。；公开 direct SDK 也接受 content:Buffer 与 path 二选一；invoke 描述入口使用本地 path。；不会压缩图片、解析PDF或清除旧对象；fixedName 可能覆盖同名对象。
- 前置：接入方在 SDK 创建期注入 accessKeyId、accessKeySecret、bucket、endpoint；Portal 会话 token 不能替代 OSS 凭据。

### 参数契约

| 参数 | 含义与来源 | 格式/默认 |
| --- | --- | --- |
| path | 要读取并上传的本地文件路径；来源：调用方本地已准备的文件 | 可读文件路径，与直接SDK的content互斥 |
| folder | OSS目录白名单；按目标业务选择审批/公共等目录；来源：params.options 中的 OSS_FOLDERS 实际枚举 | 必须精确匹配白名单 |
| fileName | 含扩展名的源文件名，用于推导扩展名与Content-Type；来源：原文件名，path场景默认使用basename | 字符串 |
| fixedName | 固定对象基名，不含扩展名；可能覆盖当月目录同名对象；来源：仅在调用方明确管理稳定对象名时提供 | 省略生成16位小写随机名 |
| contentType | 可选 MIME 类型覆盖；来源：文件真实媒体类型 | MIME字符串；默认 按扩展名推导，无法识别用 application/octet-stream |

### 返回与消费

`{ url, objectKey, contentType, size, acl? }`

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| url | string | 业务表单使用的公开访问URL，默认HTTPS |
| objectKey | string | 桶内对象键，ACL查询与清理必须使用它 |
| contentType | string | 实际上传MIME类型 |
| size | number | 文件字节数，单位byte |
| acl | string，可缺失 | GET ACL实际读回值；缺失表示复核失败，不代表上传失败 |

空结果：上传成功返回对象；不返回空列表或null。ACL字段可缺失。

- 保存 url 和 objectKey：url 给附件表单，objectKey 用于复核/补ACL/清理；不要把objectKey当URL。
- acl=public-read 才证明已读回公共读；缺失时进一步查询，不重新上传字节。

### 操作步骤与验证

- recovery：acl缺失或需要再次核实 → base-upload-acl-get；读取实际ACL；不是重传。；字段映射 {"objectKey":"objectKey"}
- cancel：业务未提交且确认对象无引用需要清理 → base-upload-delete；删除本次对象不可恢复；先确保无业务引用。；字段映射 {"objectKey":"objectKey"}

完成判据：文件URL和对象键已交付，ACL已核实或明确报告未核实；表单提交另走业务能力。

错误：OssCredentialError 由接入方补 OSS 配置；不从页面或仓库抓取密钥。；OssUploadParamError 先修正本地路径/对象键/目录；OssRequestError 保留 status、code、requestId、ossMessage 供定位。；PUT文件成功后设ACL失败时对象可能已经存在；已知objectKey可补ACL。若网络失败且没有拿到随机objectKey，不能盲目重试声称无副作用，应交由接入方核实桶。

防重：无requestId防重；重试默认随机名会生成多个对象；fixedName重试可能覆盖，不等于无风险幂等。

## base-upload-acl-get

读取指定OSS对象的访问控制ACL。

- 场景：核实上传后的可读性或修改ACL后的真实状态。
- 性质：read
- 边界：只读ACL，不下载文件内容，也不证明业务表单已引用对象。
- 前置：接入方在 SDK 创建期注入 accessKeyId、accessKeySecret、bucket、endpoint；Portal 会话 token 不能替代 OSS 凭据。

### 参数契约

| 参数 | 含义与来源 | 格式/默认 |
| --- | --- | --- |
| objectKey | 桶内对象路径，不能用公开 URL 代替。禁止前导 /、空路径段、.、..、空白及 ? # %。；来源：base-upload-file 返回 objectKey；或接入方明确提供待管理对象键 | 非空字符串 |

### 返回与消费

`string | undefined`

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| $ | string，可缺失 | XML Grant原文，可能为 public-read/private/public-read-write/default；无法解析Grant为undefined |

空结果：undefined表示未读到Grant，不等于private；对象不存在/请求拒绝按错误返回。

- public-read表示允许公开读取；private需签名；default继承桶权限不能直接判公开；public-read-write允许公开读写。

### 操作步骤与验证

- recovery：已确认本次上传对象ACL设置失败且应为公开读 → base-upload-acl-set；传 acl=public-read，成功后再读回核实。；字段映射 {"objectKey":"输入objectKey"}

完成判据：已报告实际ACL或无法核实原因。

错误：OssCredentialError 由接入方补 OSS 配置；不从页面或仓库抓取密钥。；OssUploadParamError 先修正本地路径/对象键/目录；OssRequestError 保留 status、code、requestId、ossMessage 供定位。

防重：只读/本地能力，无写入防重要求。

## base-upload-acl-set

修改一个已知OSS对象的访问权限，修复上传后ACL设置失败。

- 场景：对象字节已存在且只需补设ACL；不要重新上传。
- 性质：write
- 边界：修改公共可读/可写范围；不返回文件URL，也不自动读回验证。
- 前置：接入方在 SDK 创建期注入 accessKeyId、accessKeySecret、bucket、endpoint；Portal 会话 token 不能替代 OSS 凭据。

### 参数契约

| 参数 | 含义与来源 | 格式/默认 |
| --- | --- | --- |
| objectKey | 桶内对象路径，不能用公开 URL 代替。禁止前导 /、空路径段、.、..、空白及 ? # %。；来源：base-upload-file 返回 objectKey；或接入方明确提供待管理对象键 | 非空字符串 |
| acl | 目标访问权限；来源：当前业务明确要求，Portal上传默认public-read | public-read | private | public-read-write | default |

### 返回与消费

`undefined (Promise<void>)`

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| $ | undefined | 请求完成无业务回执；不能从返回值证明ACL已生效 |

空结果：undefined是正常成功返回，不是失败。

- 调用后用同一objectKey读ACL并比对目标值；public-read-write意味着任何人可写，不能误当普通公共读。

### 操作步骤与验证

- required：设置请求成功或结果不确定 → base-upload-acl-get；核对返回Grant与输入acl；default仅表示继承桶规则。；字段映射 {"objectKey":"输入objectKey"}

完成判据：读回ACL与目标一致，或明确报告读回失败。

错误：OssCredentialError 由接入方补 OSS 配置；不从页面或仓库抓取密钥。；OssUploadParamError 先修正本地路径/对象键/目录；OssRequestError 保留 status、code、requestId、ossMessage 供定位。

防重：无requestId；同一对象重复设置同一ACL通常收敛到同状态，先读回再决定是否重发。

## base-upload-delete

永久删除指定OSS对象，清理不再被业务引用的上传文件。

- 场景：清理本次未提交业务产生的孤儿文件；删除多个对象用delete-multi。
- 性质：write
- 边界：不可撤销；不取消流程、不删除数据库附件引用。；不存在对象也返回成功，回执不证明之前存在或实际删除了字节。
- 前置：接入方在 SDK 创建期注入 accessKeyId、accessKeySecret、bucket、endpoint；Portal 会话 token 不能替代 OSS 凭据。

### 参数契约

| 参数 | 含义与来源 | 格式/默认 |
| --- | --- | --- |
| objectKey | 桶内对象路径，不能用公开 URL 代替。禁止前导 /、空路径段、.、..、空白及 ? # %。；来源：base-upload-file 返回 objectKey；或接入方明确提供待管理对象键 | 非空字符串 |

### 返回与消费

`{ objectKey }`

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| objectKey | string | 规范化后已向OSS发出DELETE的对象键；不是存在性证据 |

空结果：对象不存在也正常返回objectKey。

- 保留对象键；删除后读取ACL只有明确不存在的响应才是不存在证据，权限/网络错误不能证明删除。

### 操作步骤与验证

- required：需要核实对象已不存在 → base-upload-acl-get；检查OSS明确的不存在错误；其它错误只能报告无法核实。；字段映射 {"objectKey":"objectKey"}

完成判据：已发删除并取得独立不存在证据，或如实报告删除结果未核实。

错误：OssCredentialError 由接入方补 OSS 配置；不从页面或仓库抓取密钥。；OssUploadParamError 先修正本地路径/对象键/目录；OssRequestError 保留 status、code、requestId、ossMessage 供定位。

防重：OSS DeleteObject对不存在键也成功；可对同一键重发，但不得将权限错误当不存在。

## base-upload-delete-multi

一次删除最多1000个OSS对象并逐项报告结果。

- 场景：已明确要清理一批无业务引用的对象。
- 性质：write
- 边界：永久删除，不可恢复；不会自动拆成多次请求；Deleted与Error可以同时存在。；Deleted是OSS接受删除的键，不能据此证明对象此前存在。
- 前置：接入方在 SDK 创建期注入 accessKeyId、accessKeySecret、bucket、endpoint；Portal 会话 token 不能替代 OSS 凭据。

### 参数契约

| 参数 | 含义与来源 | 格式/默认 |
| --- | --- | --- |
| objectKeys | 待删除的桶内对象键集合，逐项遵守objectKey安全规则；来源：多个base-upload-file.objectKey或已确认的清理清单 | 字符串数组或英文逗号/换行串；1–1000项 |

### 返回与消费

`{ deleted: string[], errors: {key?,code?,message?}[] }`

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| deleted[] | string | OSS Deleted中返回的对象键 |
| errors[].key | string，可缺失 | 删除失败的对象键 |
| errors[].code | string，可缺失 | OSS逐项错误码原文，不伪造业务错误码 |
| errors[].message | string，可缺失 | OSS逐项错误说明 |

空结果：errors=[]表示未报告逐项错误；deleted=[]时须对照输入，不假定整批已删除。

- 将输入逐项与deleted/errors核对；仅对明确可恢复的失败项重试，不无差别重复整批。

### 操作步骤与验证

- optional：需要核实关键对象已不存在 → base-upload-acl-get；逐个检查明确的不存在错误；请求/权限失败不算不存在证据。；字段映射 {"objectKey":"deleted[]"}

完成判据：每个输入键都有删除结果或被标明未确认；失败项已明确列出。

错误：OssCredentialError 由接入方补 OSS 配置；不从页面或仓库抓取密钥。；OssUploadParamError 先修正本地路径/对象键/目录；OssRequestError 保留 status、code、requestId、ossMessage 供定位。；超1000或空集合在SDK侧拒绝；分批由调用方显式管理，保存每批结果。

防重：删除缺失对象也可能回Deleted；按同一对象键重试收敛，但仍需处理部分失败。
