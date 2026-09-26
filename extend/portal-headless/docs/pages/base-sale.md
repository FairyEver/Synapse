# base-sale：AI 使用契约

2026-09-22 范围：7 个已注册且接入执行层的基础能力。基础上下文不是 Portal 菜单页面，不计入页面覆盖数。

权威定义：`src/catalog/contracts-base.ts`。SDK 通过 `catalog.describe(id).ai` 返回以下业务契约，`returns.fields` 和 `params[].contract` 同源；执行入口由 `describe(id).invoke` 返回。通用调用为 `sdk.capabilities.invoke(id, args)`。以下内容从同一契约生成，避免另一套手写参数/返回说明。

证据：对应能力实现、`test/base-sale.test.ts` 的历史真机形状夹具；历史只读/OSS验收详见 `docs/base/`。本轮为离线语义验证，没有重放真实写入。

## base-sale-shop-info

读取当前销售店铺的经营资料、归属和地区编码。

- 场景：核对当前店铺是谁、在哪个地区；不是多店铺搜索。
- 性质：read
- 边界：销售实例 sale 的当前账号范围；白名单排除了身份证与证件图。
- 前置：接入方已显式配置 sale 实例请求地址与当前用户租户会话。

### 参数契约

无调用参数。

### 返回与消费

`ShopInfo 白名单对象；各属性均为 string|null`

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| shopId | string，可null | 店铺 ID |
| shopName | string，可null | 店铺简称 |
| shopAllName | string，可null | 店铺全名 |
| shopType | string，可null | 店铺类型，历史观测 store 为自营 |
| shopTypeName | string，可null | 后端提供的类型显示名 |
| status | string，可null | 店铺状态；active 为已开通/正常，其它值不套用开店申请状态 |
| sellerId | string，可null | 商家 ID |
| shopuserName | string，可null | 店铺使用人姓名 |
| servicesTel | string，可null | 店铺服务电话 |
| email | string，可null | 店铺邮箱 |
| shopLogo | string，可null | 店铺标志 URL |
| shopAddr | string，可null | 详细地址 |
| shopArea | string，可null | 行政区划 ID 英文逗号串，不是地区名称 |
| bulletin | string，可null | 公告 |
| openTime | string，可null | 开通时间原字符串；历史值为秒级 Unix 时间戳的字符串，先验证格式再换算 |
| closeTime | string，可null | 关闭时间原字符串，null 不等于已关闭 |
| closeReason | string，可null | 关闭原因 |
| openType | string，可null | 开通类型，历史观测 supplier 为供应商 |

空结果：形状错误抛 BaseSaleShapeError；可空字段不代表空店铺。

- 展示店铺名称及地址；shopArea 非空时先转地区名称；shopTypeName 优先于自行猜类型。

### 操作步骤与验证

- optional：shopArea 非空且要展示地区名称 → base-sale-area-describe；逗号串无需拆解即可直接传 ids。；字段映射 {"ids":"shopArea"}

完成判据：店铺资料及地区名称已交付。

错误：SaleNotWiredError 表示未注入 saleRequest/baseUrls.sale；由接入方配置销售实例，不能换用默认 platform 地址。；BaseSaleShapeError 表示响应形状不匹配；不要把接线错误读成没有店铺或候选。

防重：只读/本地能力，无写入防重要求。

## base-sale-area-search

按名称搜索行政区划候选，区分同名地区的完整路径。

- 场景：用户给出地区名称片段时；逐层选择用 area-children。
- 性质：read
- 边界：后端无过滤接口，SDK 拉完整地区树后缓存并本地过滤，节省上下文而非首轮网络量。
- 前置：使用已绑定当前用户和租户的 SDK 会话。

### 参数契约

| 参数 | 含义与来源 | 格式/默认 |
| --- | --- | --- |
| keyword | 区划名称片段，忽略大小写；来源：先向用户取得名称片段；不要用空串请求长候选集 | 去首尾空白的非空字符串 |
| limit | 最多返回条数；本地裁剪，不是服务端分页。超过上限截断到上限。；来源：调用方按展示预算填写 | 正整数，上限 200；无效值回退默认值，非正数归为1，小数取整；默认 50 |

### 返回与消费

`{ areas: AreaEntry[], total, matched, truncated }`

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| areas[].id | number | 行政区划标识，供 parentId 或 ids 使用 |
| areas[].parentId | number | 上级区划标识，0 是根 |
| areas[].value | string | 行政区划名称；名称字段叫 value，不是 name |
| areas[].pathIds[] | number | 从根到本节点的标识路径，含本节点 |
| areas[].pathNames[] | string | 从根到本节点的名称路径，同名不同级仍保留 |
| areas[].hasChildren | boolean | 是否有直接下级，可决定是否继续下钻 |
| total | number | 过滤前完整索引条数，不是本次返回条数 |
| matched | number | 过滤命中数，可能大于当前返回数组长度 |
| truncated | boolean | true 表示返回集合不完整；不能把当前结果当全集 |

空结果：areas=[] 且 matched=0 是无名称匹配。

- 展示 pathNames.join("/") 区分同名区划；名称字段是 value。

### 操作步骤与验证

- optional：选定地区 hasChildren=true 且需继续下钻 → base-sale-area-children；用所选数字 id 查询直接下级。；字段映射 {"parentId":"areas[].id"}

完成判据：取得用户确认地区及其完整路径。

错误：SaleNotWiredError 表示未注入 saleRequest/baseUrls.sale；由接入方配置销售实例，不能换用默认 platform 地址。；BaseSaleShapeError 表示响应形状不匹配；不要把接线错误读成没有店铺或候选。；keyword 空值拒绝；不应以空关键字绕过长候选限制。

防重：只读/本地能力，无写入防重要求。

## base-sale-area-children

从省级根或已知地区逐层查询直接下级。

- 场景：用户选择省市区或不知道准确名称时。
- 性质：read
- 边界：parentId=0 为根；未知父 ID 与合法叶子要靠 parentFound 区分。
- 前置：使用已绑定当前用户和租户的 SDK 会话。

### 参数契约

| 参数 | 含义与来源 | 格式/默认 |
| --- | --- | --- |
| parentId | 父区划数字 ID，0 取省级根；来源：base-sale-area-search.areas[].id 或上次 children[].id，根用0 | 可转有限数字，取整 |
| limit | 最多返回条数；本地裁剪，不是服务端分页。超过上限截断到上限。；来源：调用方按展示预算填写 | 正整数，上限 200；无效值回退默认值，非正数归为1，小数取整；默认 50 |

### 返回与消费

`{ parentId, children: AreaEntry[], matched, truncated, parentFound }`

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| parentId | number | 实际查询父 ID |
| children[].id | number | 行政区划标识，供 parentId 或 ids 使用 |
| children[].parentId | number | 上级区划标识，0 是根 |
| children[].value | string | 行政区划名称；名称字段叫 value，不是 name |
| children[].pathIds[] | number | 从根到本节点的标识路径，含本节点 |
| children[].pathNames[] | string | 从根到本节点的名称路径，同名不同级仍保留 |
| children[].hasChildren | boolean | 是否有直接下级，可决定是否继续下钻 |
| matched | number | 该父级全部直接子节点数 |
| truncated | boolean | true 表示返回集合不完整；不能把当前结果当全集 |
| parentFound | boolean | 父节点存在或为0；false为未知父ID |

空结果：children=[] 且 parentFound=true 是无下级；parentFound=false 是无此父节点。

- 只对 hasChildren=true 的候选继续下钻；truncated 时增加 limit 或按名称搜索。

### 操作步骤与验证

- optional：所选 children[].hasChildren=true → base-sale-area-children；重复同一只读能力逐层选择。；字段映射 {"parentId":"children[].id"}

完成判据：选定所需粒度区划，或已到叶子节点。

错误：SaleNotWiredError 表示未注入 saleRequest/baseUrls.sale；由接入方配置销售实例，不能换用默认 platform 地址。；BaseSaleShapeError 表示响应形状不匹配；不要把接线错误读成没有店铺或候选。

防重：只读/本地能力，无写入防重要求。

## base-sale-area-describe

把地区 ID 串翻译为地区节点与最深节点的完整名称路径。

- 场景：展示店铺 shopArea 或已有地区选择值。
- 性质：read
- 边界：path 取已知节点中最深一个的完整路径，不是把每个节点路径再拼一次；多个无关联节点不能当作同一地址。
- 前置：使用已绑定当前用户和租户的 SDK 会话。

### 参数契约

| 参数 | 含义与来源 | 格式/默认 |
| --- | --- | --- |
| ids | 一个或多个区划 ID；来源：base-sale-shop-info.shopArea 或区划候选 id | 数字、英文逗号串或数字/字符串数组 |

### 返回与消费

`{ areas: AreaEntry[], unknown: number[], path }`

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| areas[].id | number | 行政区划标识，供 parentId 或 ids 使用 |
| areas[].parentId | number | 上级区划标识，0 是根 |
| areas[].value | string | 行政区划名称；名称字段叫 value，不是 name |
| areas[].pathIds[] | number | 从根到本节点的标识路径，含本节点 |
| areas[].pathNames[] | string | 从根到本节点的名称路径，同名不同级仍保留 |
| areas[].hasChildren | boolean | 是否有直接下级，可决定是否继续下钻 |
| unknown[] | number | 输入中未在索引找到的区划ID；这是实际响应字段名 |
| path | string | 最深已知节点的完整路径，使用 / 连接 |

空结果：全部未知时 areas=[]、path=""，unknown 保留未识别ID。

- 地址显示用 path；unknown 非空要报告部分未识别，不宣称地区被删除。

### 操作步骤与验证

- optional：查询已满足用户目的 → 交付结果；将路径与未识别ID一起交付；没有必须下游调用。

完成判据：已解释全部输入ID或明确列出未识别项。

错误：SaleNotWiredError 表示未注入 saleRequest/baseUrls.sale；由接入方配置销售实例，不能换用默认 platform 地址。；BaseSaleShapeError 表示响应形状不匹配；不要把接线错误读成没有店铺或候选。；非数字或空ID输入需修正；未识别的合法数字不会抛错。

防重：只读/本地能力，无写入防重要求。

## base-sale-manufacturer-search

按厂商名取得厂商候选 ID。

- 场景：业务需厂商或要进一步筛选其品牌。
- 性质：read
- 边界：全表加载后本地忽略大小写过滤；厂商响应不提供可用品牌清单，不能读 brandList 推断品牌。
- 前置：使用已绑定当前用户和租户的 SDK 会话。

### 参数契约

| 参数 | 含义与来源 | 格式/默认 |
| --- | --- | --- |
| keyword | 厂商名称片段；来源：先向用户取得名称片段；不要用空串请求长候选集 | 去首尾空白的非空字符串 |
| limit | 最多返回条数；本地裁剪，不是服务端分页。超过上限截断到上限。；来源：调用方按展示预算填写 | 正整数，上限 100；无效值回退默认值，非正数归为1，小数取整；默认 20 |

### 返回与消费

`{ manufacturers: {manufacturerId,manufacturerName}[], total, matched, truncated }`

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| manufacturers[].manufacturerId | number | 厂商 ID，供品牌筛选使用 |
| manufacturers[].manufacturerName | string | 厂商显示名 |
| total | number | 过滤前完整索引条数，不是本次返回条数 |
| matched | number | 过滤命中数，可能大于当前返回数组长度 |
| truncated | boolean | true 表示返回集合不完整；不能把当前结果当全集 |

空结果：manufacturers=[] 是无名称匹配。

- 展示名称让用户确认厂商；使用 manufacturerId 而不是数组下标。

### 操作步骤与验证

- optional：用户要查看所选厂商下某类品牌 → base-sale-brand-search；另向用户取得品牌 keyword，厂商ID不能替代必填品牌关键字。；字段映射 {"manufacturerId":"manufacturers[].manufacturerId"}

完成判据：已交付厂商候选或取得用户选择的厂商ID。

错误：SaleNotWiredError 表示未注入 saleRequest/baseUrls.sale；由接入方配置销售实例，不能换用默认 platform 地址。；BaseSaleShapeError 表示响应形状不匹配；不要把接线错误读成没有店铺或候选。；空 keyword 被拒绝，先收窄名称。

防重：只读/本地能力，无写入防重要求。

## base-sale-brand-search

按品牌名及可选厂商过滤品牌候选。

- 场景：需要品牌 ID 或核对品牌所属厂商。
- 性质：read
- 边界：keyword 必填，即使提供 manufacturerId 也不能省；本地过滤完整品牌索引。
- 前置：使用已绑定当前用户和租户的 SDK 会话。

### 参数契约

| 参数 | 含义与来源 | 格式/默认 |
| --- | --- | --- |
| keyword | 品牌名称片段；来源：先向用户取得名称片段；不要用空串请求长候选集 | 去首尾空白的非空字符串 |
| manufacturerId | 可选所属厂商过滤，有限数字才生效；来源：base-sale-manufacturer-search.manufacturers[].manufacturerId | 数字 |
| limit | 最多返回条数；本地裁剪，不是服务端分页。超过上限截断到上限。；来源：调用方按展示预算填写 | 正整数，上限 100；无效值回退默认值，非正数归为1，小数取整；默认 20 |

### 返回与消费

`{ brands: {brandId,brandName,manufacturerId}[], total, matched, truncated }`

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| brands[].brandId | number | 品牌 ID，业务品牌参数值 |
| brands[].brandName | string | 品牌显示名 |
| brands[].manufacturerId | number，可null | 所属厂商 ID；null表示未提供 |
| total | number | 过滤前完整索引条数，不是本次返回条数 |
| matched | number | 过滤命中数，可能大于当前返回数组长度 |
| truncated | boolean | true 表示返回集合不完整；不能把当前结果当全集 |

空结果：brands=[] 是名称与厂商组合没有匹配。

- 展示 brandName，用 brandId 填业务参数；manufacturerId 不可当品牌ID。

### 操作步骤与验证

- optional：查询已满足用户目的 → 交付结果；交付候选品牌或用户确认的 brandId；未注册商品写能力不能自行编造调用。

完成判据：候选已解释且用户选择已明确。

错误：SaleNotWiredError 表示未注入 saleRequest/baseUrls.sale；由接入方配置销售实例，不能换用默认 platform 地址。；BaseSaleShapeError 表示响应形状不匹配；不要把接线错误读成没有店铺或候选。；keyword 缺失被拒绝；非法 manufacturerId 会被当未过滤，调用前确保数字避免范围扩大。

防重：只读/本地能力，无写入防重要求。

## base-sale-home-tip

查询销售首页是否有未付款和待发货订单提示。

- 场景：询问当前店铺是否存在待处理订单提醒；不能回答订单总数或明细。
- 性质：read
- 边界：两个字段均为布尔标志，不是数量；两者为true时前端优先提示未付款。
- 前置：使用已绑定当前用户和租户的 SDK 会话。

### 参数契约

无调用参数。

### 返回与消费

`{ unpaidTip: boolean, waitShipTip: boolean }`

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| unpaidTip | boolean | 有未付款订单提示，对应前端 orderDealModal(10) |
| waitShipTip | boolean | 有待发货订单提示；前端仅在 !unpaidTip 时弹该提示 |

空结果：两者false表示无这两类首页提示，不证明不存在任何订单。

- 先报告未付款；再说明待发货标志，不能把true转成1条。

### 操作步骤与验证

- optional：查询已满足用户目的 → 交付结果；交付提醒；当前基础能力不提供订单明细和订单办理入口，不能伪造下一步能力。

完成判据：已报告两类提醒及不含明细的范围。

错误：SaleNotWiredError 表示未注入 saleRequest/baseUrls.sale；由接入方配置销售实例，不能换用默认 platform 地址。；BaseSaleShapeError 表示响应形状不匹配；不要把接线错误读成没有店铺或候选。

防重：只读/本地能力，无写入防重要求。
