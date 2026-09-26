# `src/catalog/` —— 目录、检索、与「可见性收敛」

这一层的职责：**AI 怎么知道该调哪个页面**。目录有 1,019 行页面（D24 的「页面唯一参考清单」），
一次性塞进上下文会撑爆，所以是分层的：`listDomains` → `listPages` → `describePage` → `describe`，
外加 `search` / `recommend` 两条入口。

| 文件 | 干什么 |
| --- | --- |
| `catalog-index.ts` | 把「页面清单」+「已注册能力定义」合成可下钻的索引（`buildIndex`） |
| `list.ts` / `describe.ts` / `search.ts` / `recommend.ts` | 四条读入口，全部**索引驱动** |
| `visibility.ts` | 可见性过滤的**纯实现**（归一化、判定、报告），433 行，一行请求都不发 |
| `index.ts` | `createCatalog()` 门面 + 本文件 §2 那层接线（`withVisibility` / `visibleCatalogFrom`） |
| `validate.ts` / `matching` / `aliases*` | 自检与匹配（与可见性无关） |

---

## §1 可见性过滤**不是一个开关**，是一份视图

`Catalog.withVisibility(visibility)` 返回 `{ catalog, report }`：`catalog` 是**只含可见页面**的
目录子集，签名与全量目录完全一致；`report` 说清哪些可见、哪些被收敛掉、为什么。

实现上它是**重建一份索引**（`scopeIndex()`），不是给四条读入口各打一个补丁。理由是那四条入口
全是索引驱动的：重建一次，它们同时收敛，`list.ts` / `describe.ts` / `search.ts` / `recommend.ts`
四个文件**一个字都不用改**。

三件刻意的事：

1. **视图里的页面对象是新建的**（浅拷贝一层）。直接复用全量索引里的对象会出两种错：
   改一个 `capabilityIds` 就污染了别人看到的那一份；视图里的 `capabilityIds` 还会指向
   已经被收敛掉的能力。
2. **能力跟着页面走，判据是「任一 `pagePath` 可见」**。取"任一"而不是"全部"：
   误杀一个其实还调得动的能力，比多留一条更糟（conventions 第 15 条）。
   同 ID 多份定义的能力（`buildIndex` 会合并）因此不会因为主定义在不可见页面上就整条消失。
3. **`validate()` 仍然打在全量索引上**。自检查的是别名 / 链接 / lookup 这些**静态数据表**，
   与"某个用户能不能看到某个页面"无关；打在子集上会凭空报一堆死链，把真实的数据问题淹掉。

## §2 决策：过滤发生在**哪一层**（这是本模块最要紧的一节）

三个候选，逐个说清为什么不选前两个：

| 候选 | 为什么不 |
| --- | --- |
| **`createCatalog` 构造期** | 菜单树要打网络，而 `createCatalog` 是**同步的纯函数**（`listDomains()` 这些现在全都是同步的）；构造期也拿不到——多用户门面里一份目录服务多个用户，"这个用户"在构造期根本不存在 |
| **每次 `describe` / `search` / `recommend` 时自动过滤** | 三个理由，任何一个都够：① 会把整个目录 API 变成 async，波及每一处调用与测试；② **更根本的是 conventions 第 15 条** —— 菜单树不是权限裁决，自动过滤 = 把"不在菜单里但其实可调"的能力藏起来；③ 可见性是 per-(用户, 租户, 项目) 的，而多用户门面里目录是**服务级共享的静态数据**，在共享实例上过滤 = 让一个用户的可见面污染另一个用户（同 `getMenuNav` 的缓存键必须带 `project` 那个坑：同实例、不同上下文 = 不同数据） |
| **显式入口（本模块选的）** | 目录层给**纯**的 `withVisibility(visibility)`（调用方自己拿菜单树），门面层给**取菜单 + 收敛**的 `visibleCatalog({ project })`。不自动生效 ⇒ 不可能悄悄藏掉能力；要收敛就显式调一次，且拿到的是一份可解释的视图 |

一句话：**下发面收敛是调用方的一次显式选择，不是目录的默认行为。**
`portal.catalog`（未过滤）与所有能力方法一个字都不变——所以"收敛"永远不等于"拦住"。

### 为什么不把它做成一个能力

想过，不做。能力是"AI 可以调的一个工具"，而可见性是**接线层**对下发面的决定：
它决定了"AI 能看到哪些工具"，自己不该是其中一个工具，否则就成了"AI 可以自己给自己放宽范围"。
另外目录不经过 `call()`（它不是 Portal 页面，没有页面上下文），做成能力还要给它编一个合成路径。

## §3 接线的两半

```
baseShell.getMenuNav({ project })                      ← 网络，per-(用户, 项目)
  └─ createUserVisibility({ menuTree })                ← 归一化（visibility.ts）
       └─ catalog.withVisibility(visibility)           ← 子集视图（纯，无 IO）
            └─ portal.visibleCatalog({ project })      ← 门面把两半接起来
                 / scoped.visibleCatalog({ project })  ← 多用户门面，**按会话**
```

- **单用户**：`createPortalHeadless(config).visibleCatalog(input)`（`src/index.ts`）。
- **多用户**：`createPortalServer(...).forSession(input).visibleCatalog(input)`（`src/server.ts`）。
  ⚠️ 这一条**必须**挂在这份会话上，走这份会话的 `baseShell`：菜单是 per-user 的，
  服务级那份 `PortalServer.catalog` 是共享的静态数据，在它上面过滤会把一个人的可见面泄漏给另一个人。
- 两处调用的是**同一个** `visibleCatalogFrom()`（`src/catalog/index.ts`），不是各写一遍——
  "两套实现靠约定对齐"在这个仓库已经坏过（H8）。
- 自己拿菜单树的调用方（例如想换个菜单来源、或自己管缓存）走纯的那一半：
  `createUserVisibility()` → `catalog.withVisibility()`。

### 什么时候取菜单

**调用方要的时候才取**，不在 SDK 构造期。`getMenuNav` 侧有 30 分钟实例内缓存 + 并发单飞，
但那份缓存在**能力实例内**（见 `docs/base/可见菜单.md` 的缓存一节），而多用户门面的
`forSession()` 每次调用建一份新的 `baseShell`。所以：**`visibleCatalog()` 可能是一次真实的往返**，
一份会话里想复用就自己存一下那个返回值（它是个快照，`report` 里带着菜单来源）。

⚠️ 别传 `keyword` 去裁剪菜单树。被关键字裁过的树不是"少几个节点"，是**缺路径**——
拿它算可见性会把"其实可见"的页面判成不可见。门面因此**不接受 `keyword`**（不接受就不会误用），
只有 `project` 与 `maxNodes`。同理，`truncated: true` 的树一律不能拿来算可见性（见 §4）。

## §4 拿不到菜单树时怎么办：**默认失败关闭**

| 情形 | 默认（`onUnavailable: 'throw'`） | 显式降级（`'unfiltered'`） |
| --- | --- | --- |
| 取数失败（网络 / 凭据 / 形状不认识） | 抛 `MenuVisibilityUnavailableError`（`cause` 保留原错误） | `applied: false`、`report: null`、`catalog` 就是**未过滤**的那一份、`note` 说明原因 |
| 树被截断（`truncated`） | 同上，理由里点明"截断的树会误杀" | 同上 |
| `project` 缺失 / 不是数字 | 抛 `TypeError`，**一个请求都不发** | 同上（参数错误**不**降级——吞了它等于静默地不做过滤） |

- 为什么**取不到就失败关闭**：这个入口的契约是"给我收敛后的面"。拿不到菜单却回全量属于
  **静默放大**——调用方看不出这份目录没被收窄过（与 conventions 第 1 条"不传 `module-type`
  是放大不是缩小"是同一类错）。安全退路是**显式**的：用 `portal.catalog`，或传
  `onUnavailable: 'unfiltered'`。
- 为什么**截断也失败关闭**：截断缺的是节点，方向是**误杀**——AI 会被告知"你没有这个页面"，
  比放大更隐蔽。`base-shell` 的文档也明写"不要拿截断的树去算可见性"。
- 为什么 `project` 单独再挡一道：`Number(null)` 与 `Number('')` 都是 0（有限值），
  不挡的话"我漏了参数"会被静默当成 `project=0`（实测返回空树），被读成"这个人一个菜单都没有"。
  这条规则与 `base-shell` 的 `resolveProject` **同一条**，在这里再挡一次是为了**先于网络失败**
  （否则 `'unfiltered'` 会把参数错误一起吞掉）。

## §5 收敛 ≠ 拦住（conventions 第 15 条）

实测反例：某账号的 `/dashboard/meeting-room/list` 不在它的 `nav?project=2` 里，但该能力是可调的。
所以视图里没有一条能力，不等于它调不动。这一点在代码里有两处**看得见**的落点：

- `describe()` 在视图里没命中时，理由会被换成准确的那一条（`outsideVisibilityReason()`）：
  "能力『x』在目录里，但它所在的页面（…）不在这次的可见菜单口径内 …… 这只是下发面收敛，
  不是权限裁决：未过滤的目录在 `portal.catalog`，执行入口在 `sdk.capabilities.invoke()`"。
  原样回 `describe.ts` 那句「目录里没有能力」是说假话，还会把调用方引向"去注册这个能力"。
  真的不在目录里时，那句理由一个字都不改。
- `report` 把"被收敛掉的页面"逐条列出来（`hiddenPages`，含 `probedKeys`——拿什么去比过），
  而不是只给一个数字。

## §6 没做 / 不确定

- **没有自动过滤**，也不打算做（§2）。`portal.catalog` 永远是全量。
- **没有把 scope 缓存进门面**。每次 `visibleCatalog()` 可能各打一次 `menu-nav`；
  多用户门面里 `forSession()` 每次新建 `baseShell`，实例内那份 30 分钟缓存兜不住跨请求。
  要复用就由调用方持有返回值。**没有实测**过"一次会话里连打十次"的真实开销。
- **`project` 的取值语义没有查全**（见 `docs/base/可见菜单.md`）：实测 1 / 2 / 3 / 0，
  别的合法值没查，所以门面只校验"必填且是数字"，不校验取值范围。
- **`selectRoleMenuListNotBySystem`（跨系统口径）没有接**。它是"普通角色账号看不到全部菜单"
  的潜在答案；`test/visibility.test.ts` 里已经有一组拿它当 `paths` 喂进去的用例，
  但**没有实测过它的真实响应**，所以不做。要接就是在门面里换一个 `MenuTreeSource`。
- **菜单树里的"能力页"以外，还有一类没处理**：菜单里有、目录里没有实现的路径
  （`menuOnlyPaths`，夹具里 3 条）。它现在只出现在 `report` 里，没有对应的下发动作。

## §7 反证记录（2026-09-21，`test/visibility-wiring.test.ts` 17 例）

写完把每一条断言改坏一次，确认会红：

| 改坏什么 | 红了几条 |
| --- | --- |
| 能力不过滤（视图里保留全部能力） | 5 |
| 视图页面不浅拷贝（与全量索引共享对象） | 1 |
| `validate()` 打在子集索引上 | 1 |
| `onUnavailable` 默认改成 `'unfiltered'` | 3 |
| 不检查 `truncated` | 1 |
| `describe` 没命中时不换理由 | 1 |
| 可见性判据改成"只看 `primary.pagePath`" | 1（**第一次跑时 0 条**，见下） |
| 去掉 `project` 的前置校验 | 1 |
| 把 scope 缓存在服务级（跨会话共享） | 1 |

**一条真实的覆盖缺口**：第 7 行那个改动第一次跑时**当时的全套 16 例全绿**——因为真实能力表里
没有"同 ID 两处定义"的形状，所有能力都只有一条 `pagePath`，"任一可见"与"只看 primary"
在数据上等价。补了一个合成两条定义的用例（`同一能力挂在多页时…`）之后才红。
记在这里是因为：**"没测到"不等于"已验证"**。

## §8 真机只读冒烟（2026-09-21，测试环境）

`smoke/with-portal-token.sh` + 一个临时用例（**全程只读 GET**，用完删除，不是仓库里的常驻脚本）：

```
visibleCatalog({ project: 2 })
  36 条可见路径 → 53/1040 个页面可见（32 靠菜单命中，21 是菜单里没有的能力页）
  987 个被过滤，0 个 iframe 只可跳转，另有 3 条菜单路径目录里没有实现
  域：48 → 9
  菜单来源：GET /admin-api/sys/menu/nav?project=2（57 个节点）

visibleCatalog({ project: 3 })            # 实测这个项目返回空树
  applied: true、可见路径 0 条、21 个能力页仍在
  ↑ **空菜单不是失败**：它是"这个人 0 个菜单"这个事实，照常出一份收敛到只剩能力页的视图

visibleCatalog({ project: 2, maxNodes: 1 })
  → MenuVisibilityUnavailableError（截断走失败关闭）
```

三条与夹具口径一致的事实：`32` 个菜单命中、`3` 条 `menuOnlyPaths`
（`/dashboard/agreement`、`/dashboard/manage`、`/dashboard/template`）与
`test/visibility.test.ts` 独立重数出来的完全一样 —— 说明**真实后端那一刻的菜单，
与 2026-09-20 抓的夹具是同一份口径**（换账号会变，见 `docs/base/可见菜单.md` 的告诫）。
