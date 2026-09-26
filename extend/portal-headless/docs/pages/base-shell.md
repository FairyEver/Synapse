# base-shell：AI 使用契约

2026-09-22 范围：7 个已注册且接入执行层的基础能力。基础上下文不是 Portal 菜单页面，不计入页面覆盖数。

权威定义：`src/catalog/contracts-base.ts`。SDK 通过 `catalog.describe(id).ai` 返回以下业务契约，`returns.fields` 和 `params[].contract` 同源；执行入口由 `describe(id).invoke` 返回。通用调用为 `sdk.capabilities.invoke(id, args)`。以下内容从同一契约生成，避免另一套手写参数/返回说明。

证据：对应能力实现、`test/base-shell.test.ts` 的历史真机形状夹具；历史只读/OSS验收详见 `docs/base/`。本轮为离线语义验证，没有重放真实写入。

## base-user-info

读取当前登录用户身份、组织归属与管理员标志。

- 场景：回答我是谁、在哪个组织，或给表单选择当前用户。
- 性质：read
- 边界：白名单视图不返回 password2/salt；管理员布尔值不能替代实际后端授权。
- 前置：使用已绑定当前用户和租户的 SDK 会话。

### 参数契约

无调用参数。

### 返回与消费

`ShellUserInfo 白名单对象`

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| id | string | 当前用户 ID；保持字符串避免大整数损失 |
| username | string，可null | 登录名 |
| realName | string，可null | 姓名 |
| headUrl | string，可null | 头像 URL |
| email | string，可null | 邮箱 |
| mobile | string，可null | 手机号 |
| postName | string，可null | 岗位名 |
| deptId | string，可null | 部门 ID |
| organizationId | string，可null | 组织 ID |
| organizationName | string，可null | 组织名 |
| organizationFullPathName | string，可null | 完整组织名称路径 |
| organizationCode | string，可null | 组织编码 |
| createDate | string，可null | 创建时间，后端原始字符串；未声明时区，不据此跨时区计算 |
| gender | number，可null | 性别码；0=男，1=女，2=保密 |
| status | number，可null | 用户状态；与租户状态码方向不同；0=停用，1=正常 |
| superAdmin | boolean | 是否超级管理员 |
| tenantAdmin | boolean | 是否当前租户管理员 |
| roleIds | string[]，可null | 角色 ID 列表；原 roleIdList 为 null 时仍为 null |

空结果：无有效用户对象为形状错误；可空字段 null 表示未取得。

- 优先展示 realName/username、组织名称；不要默认展示手机号等联系信息。
- 业务需数字用户 ID 时先确认目标参数要求再转换；本返回 id 始终字符串。

### 操作步骤与验证

- optional：查询已满足用户目的 → 交付结果；交付所需身份字段；不需要额外写操作。

完成判据：身份或组织问题已回答。

错误：请求失败保留原始错误并检查会话/租户；不要将失败展示成 0 条。；BaseShellShapeError 表示响应或接线异常，应报告而非假装空数据。

防重：只读/本地能力，无写入防重要求。

## base-user-search

按姓名或部门找人员候选，为审批人和业务人员字段取得 ID。

- 场景：需要选择人员但没有可靠 ID；当前本人资料改用 base-user-info。
- 性质：read
- 边界：至少 keyword/deptId 之一；查询当前用户/租户可见的人员候选，不等于当前部门名单。
- 前置：使用已绑定当前用户和租户的 SDK 会话。

### 参数契约

| 参数 | 含义与来源 | 格式/默认 |
| --- | --- | --- |
| keyword | 姓名关键字，传给后端 nickname；与 deptId 至少提供一个；来源：用户提供姓名片段 | 非空字符串 |
| deptId | 限定部门，与 keyword 可组合；来源：base-dept-search.list[].id | 数字部门 ID |
| pageNo | 从 1 开始的页码。非正数或无效值回退 1，小数取整。；来源：上一页未覆盖 total 时递增 | 正整数；默认 1 |
| pageSize | 每页数量；-1 被 SDK 拒绝，超过 50 截断到 50。；来源：调用方按上下文预算填写 | 1–50 的整数；默认 20 |

### 返回与消费

`{ list: SimpleUser[], total }`

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| list[].id | string | 人员 ID；后续人员参数的值来源 |
| list[].nickname | string，可null | 候选昵称/展示姓名 |
| list[].code | string，可null | 人员编码 |
| list[].deptName | string，可null | 部门名称；历史实测为 null，应另查部门 |
| list[].staffDuties | string，可null | 职务 |
| list[].realName | string，可null | 真实姓名 |
| list[].staffCode | string，可null | 员工编号 |
| list[].deptId | number，可null | 部门 ID，供 base-dept-get 使用 |
| total | number | 服务端过滤后的总条数；list 仅当前页 |

空结果：list=[] 表示当前筛选当前页无候选；不能把高页码的空页当成无人员。

- 用姓名、员工号、部门区分同名人，再取 id；total 大于已读数量时可翻页。

### 操作步骤与验证

- optional：同名人需要组织信息区分且 deptId 非 null → base-dept-get；读取组织路径再让用户选择。；字段映射 {"id":"list[].deptId"}

完成判据：取得用户确认的人员 ID 并传给发起能力指定的人员参数；不得替用户猜同名人。

错误：请求失败保留原始错误并检查会话/租户；不要将失败展示成 0 条。；BaseShellShapeError 表示响应或接线异常，应报告而非假装空数据。；无 keyword/deptId 或 pageSize=-1 在 SDK 侧拒绝，先收窄候选。

防重：只读/本地能力，无写入防重要求。

## base-todo-list

查询当前用户的流程待办、已办或全部任务。

- 场景：回答我的待办并取得 taskId；人力专页的扩展筛选应选 backlog-task-examine-list。
- 性质：read
- 边界：只读查询；scope 是任务完成状态，result 是流程实例结果，二者不能混淆。
- 前置：使用已绑定当前用户和租户的 SDK 会话。

### 参数契约

| 参数 | 含义与来源 | 格式/默认 |
| --- | --- | --- |
| scope | todo=待办(finished=1)，done=已办(finished=2)，all 不发 finished；不是 finished=0；来源：用户选择待办/已办/全部 | todo | done | all；默认 todo |
| name | 任务名关键字，服务端 taskNameLike 匹配；来源：用户提供任务名称片段 | 字符串 |
| pageNo | 从 1 开始的页码。非正数或无效值回退 1，小数取整。；来源：上一页未覆盖 total 时递增 | 正整数；默认 1 |
| pageSize | 每页数量；-1 被 SDK 拒绝，超过 50 截断到 50。；来源：调用方按上下文预算填写 | 1–50 的整数；默认 20 |

### 返回与消费

`{ list: TodoItem[], total, scope }`

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| list[].id | string | 任务 ID，办理时传 taskId；不是流程实例 ID |
| list[].name | string，可null | 任务名称；时间未标时区时勿自行转换 |
| list[].createTime | string，可null | 任务创建时间，原始时间字符串；时间未标时区时勿自行转换 |
| list[].claimTime | string，可null | 领取时间，原始时间字符串；时间未标时区时勿自行转换 |
| list[].processInstanceId | string，可null | 流程实例 ID，详情查询使用；时间未标时区时勿自行转换 |
| list[].title | string，可null | 流程标题；时间未标时区时勿自行转换 |
| list[].processDefinitionKey | string，可null | 流程定义 key；时间未标时区时勿自行转换 |
| list[].startUserNickname | string，可null | 发起人昵称；时间未标时区时勿自行转换 |
| list[].startUserId | number，可null | 发起人 ID |
| list[].result | number，可null | 流程实例结果码；null 表示未返回，不能视为通过；1=待提交，2=待签订/待审核，3=不通过，4=通过，8=已取消 |
| total | number | 当前筛选全部任务数 |
| scope | string | 实际查询范围 todo/done/all |

空结果：list=[] 是当前页无任务；scope=todo 且第一页 total=0 才能报告没有待办。

- 展示 title/name、发起人和创建时间；result 3/4 含义不能凭英文枚举名猜。
- 只对 scope=todo 中仍有效的任务进入办理准备，不把已办任务再次提交。

### 操作步骤与验证

- optional：用户要办理选中的待办任务 → task-action-instance；流程实例ID非null时先读取当前流程与表单；任务办理保留list[].id作为taskId，不要直接同意。；字段映射 {"processInstanceId":"list[].processInstanceId"}

完成判据：查询任务交付列表及是否还有页；办理任务需继续准备及相应动作。

错误：请求失败保留原始错误并检查会话/租户；不要将失败展示成 0 条。；BaseShellShapeError 表示响应或接线异常，应报告而非假装空数据。；scope 只允许 todo/done/all；不允许 pageSize=-1。

防重：只读/本地能力，无写入防重要求。

## base-todo-counts

同时读取待办、未读消息、待审费用三个角标数。

- 场景：只需要数量概览；需要具体任务用 base-todo-list。
- 性质：read
- 边界：三路独立读取，部分失败仍返回；null 不是 0。
- 前置：使用已绑定当前用户和租户的 SDK 会话。

### 参数契约

无调用参数。

### 返回与消费

`{ todo, unreadMessages, expensePending, failures: {key,message}[] }`

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| todo | number，可null | 待办任务总数 |
| unreadMessages | number，可null | 未读消息数 |
| expensePending | number，可null | 待审核费用数 |
| failures[].key | string | 失败项：todo/unreadMessages/expensePending |
| failures[].message | string | 对应请求错误说明 |

空结果：0 是已确认没有；null 是未取得数量，failures 记录请求失败；形状不能转数字也可能得到 null。

- 分别显示已取得数量；null 标为未取得，保留失败原因，不做合计。

### 操作步骤与验证

- optional：todo 大于 0，用户要查看具体事项 → base-todo-list；使用 scope=todo、pageNo=1 分页读取。

完成判据：已交付三项数量或对应缺失原因。

错误：逐项失败信息在 failures；不能因其它两项成功而忽略第三项未取得。；请求失败保留原始错误并检查会话/租户；不要将失败展示成 0 条。；BaseShellShapeError 表示响应或接线异常，应报告而非假装空数据。

防重：只读/本地能力，无写入防重要求。

## base-menu-nav

读取指定项目下当前用户的可见菜单树，供目录展示收敛。

- 场景：需要菜单结构或创建用户可见目录；只看路径时用 base-menu-paths。
- 性质：read
- 边界：菜单不是权限裁决；不出现不代表后端不可调用。；keyword 会保留匹配节点的祖先；这种筛选树不等于完整可见菜单。
- 前置：使用已绑定当前用户和租户的 SDK 会话。

### 参数契约

| 参数 | 含义与来源 | 格式/默认 |
| --- | --- | --- |
| project | 项目号；必须显式传，1学习型组织、2人力绩效是历史实测项目；来源：接入方当前 Portal 项目上下文或用户明确选择 | 有限数字，SDK会取整 |
| keyword | 按节点名称或 permissions 片段筛选，保留祖先；来源：用户提供，完整可见性输入时省略 | 字符串 |
| maxNodes | 最多返回条数；本地裁剪，不是服务端分页。超过上限截断到上限。；来源：调用方按展示预算填写 | 正整数，上限 500；无效值回退默认值，非正数归为1，小数取整；默认 200 |

### 返回与消费

`{ project, tree: ShellMenuNode[], totalNodes, returnedNodes, truncated }`

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| project | number | 实际项目号 |
| tree | array | 菜单树根节点，children 递归同构 |
| tree[].id | string 或 number，可null | 节点标识 |
| tree[].pid | string 或 number，可null | 父节点标识 |
| tree[].name | string，可null | 节点显示名 |
| tree[].url | string，可null | 原始 URL，历史实测为 null，不能当页面路径 |
| tree[].permissions | string，可null | 页面路径或权限码；路径连接键在此，不是 url |
| tree[].menuType | number，可null | 节点种类；0=菜单，1=按钮 |
| tree[].useSystem | number，可null | 所属系统码，1人/2财/3物/4产/5供/6销 |
| tree[].project | number，可null | 节点项目号 |
| tree[].children | ShellMenuNode[] | 递归菜单子节点，字段同根节点 |
| totalNodes | number | 筛选前全树节点数 |
| returnedNodes | number | 本次实际返回节点数，含后代 |
| truncated | boolean | true 表示返回集合不完整；不能把当前结果当全集 |

空结果：tree=[] 表示该项目下无菜单或关键词无命中，不表示无后端权限。

- 只有无 keyword 且 truncated=false 的树可作为完整可见性输入；permissions 与目录 permission 对接。

### 操作步骤与验证

- optional：完整树已取得，需要按菜单收敛目录 → visibleCatalog；门面 visibleCatalog({project}) 会自行读取完整菜单并返回目录；不要把裁剪树当权限拒绝依据。；字段映射 {"project":"project"}

完成判据：展示树已交付；可见目录只在完整菜单下建立。

错误：请求失败保留原始错误并检查会话/租户；不要将失败展示成 0 条。；BaseShellShapeError 表示响应或接线异常，应报告而非假装空数据。；truncated=true 时扩大 maxNodes 至上限仍不能完整则报告阻塞，不能静默应用可见性。

防重：只读/本地能力，无写入防重要求。

## base-menu-paths

从可见菜单摊平去重页面路径。

- 场景：只需查看可见路径列表；建立可见目录用完整菜单树。
- 性质：read
- 边界：只保留 permissions 以 / 开头的原始值，不返回动作权限码、不做路径归一。
- 前置：使用已绑定当前用户和租户的 SDK 会话。

### 参数契约

| 参数 | 含义与来源 | 格式/默认 |
| --- | --- | --- |
| project | 必须显式提供的项目号；来源：Portal 项目上下文 | 有限数字，SDK会取整 |
| keyword | 路径片段，按 includes 区分大小写匹配；来源：用户筛选条件，可省略 | 按原始输入 |
| limit | 最多返回条数；本地裁剪，不是服务端分页。超过上限截断到上限。；来源：调用方按展示预算填写 | 正整数，上限 300；无效值回退默认值，非正数归为1，小数取整；默认 100 |

### 返回与消费

`{ paths: string[], total, matched }`

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| paths[] | string | 原始 permissions 页面路径，去重 |
| total | number | 过滤前完整索引条数，不是本次返回条数 |
| matched | number | 过滤命中数，可能大于当前返回数组长度 |

空结果：paths=[] 是无路径或筛选无命中；不是权限拒绝。

- 展示原始路径；paths.length<matched 为出口裁剪，不是页面消失。

### 操作步骤与验证

- optional：要了解这些页面的已注册能力 → catalog.describePage；逐个传页面路径；只返回目录确实存在的页面，别将无能力页面宣称可调用。；字段映射 {"pageIdOrPath":"paths[]"}

完成判据：路径清单和完整性已说明。

错误：请求失败保留原始错误并检查会话/租户；不要将失败展示成 0 条。；BaseShellShapeError 表示响应或接线异常，应报告而非假装空数据。

防重：只读/本地能力，无写入防重要求。

## base-home-widgets

读取当前用户工作台已配置的卡片及布局。

- 场景：解释工作台内容或寻找卡片标识；它不查询卡片中的业务数据。
- 性质：read
- 边界：widget 是 hr/… 卡片标识，不是 /dashboard/… 页面路径，SDK 未提供二者映射。
- 前置：使用已绑定当前用户和租户的 SDK 会话。

### 参数契约

| 参数 | 含义与来源 | 格式/默认 |
| --- | --- | --- |
| keyword | 匹配 widget 或 knownModules，忽略大小写；来源：用户提供卡片/模块片段，可省略 | 按原始输入 |
| limit | 最多返回条数；本地裁剪，不是服务端分页。超过上限截断到上限。；来源：调用方按展示预算填写 | 正整数，上限 100；无效值回退默认值，非正数归为1，小数取整；默认 60 |

### 返回与消费

`{ widgets: HomeWidget[], total, matched, configured }`

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| widgets[].cardId | string，可null | 布局实例 ID，不是业务记录 ID |
| widgets[].widget | string | 模块/域/卡片标识 |
| widgets[].knownModules[] | string | 卡片声明依赖模块 |
| widgets[].layout.x | number，可null | x 布局坐标或尺寸，原始网格单位而非像素 |
| widgets[].layout.y | number，可null | y 布局坐标或尺寸，原始网格单位而非像素 |
| widgets[].layout.w | number，可null | w 布局坐标或尺寸，原始网格单位而非像素 |
| widgets[].layout.h | number，可null | h 布局坐标或尺寸，原始网格单位而非像素 |
| total | number | 过滤前完整索引条数，不是本次返回条数 |
| matched | number | 过滤命中数，可能大于当前返回数组长度 |
| configured | boolean | 是否存在有效工作台配置 |

空结果：configured=false 表示没有配置；configured=true 且 widgets=[] 可能是有效空布局或关键词无命中。

- 展示 widget 和布局，仅在业务目录中另行搜索相关业务，不能把 widget 当 capabilityId。

### 操作步骤与验证

- optional：查询已满足用户目的 → 交付结果；交付卡片配置；不推断卡片当前金额、人数或权限。

完成判据：已说明工作台卡片及是否配置。

错误：请求失败保留原始错误并检查会话/租户；不要将失败展示成 0 条。；BaseShellShapeError 表示响应或接线异常，应报告而非假装空数据。

防重：只读/本地能力，无写入防重要求。
