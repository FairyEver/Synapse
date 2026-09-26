# 浏览器基准抓取手册

`baseline/*.browser.json` 记录的是**浏览器真实发出的请求**，测试拿它当逐字段基准（设计 D20）。
本手册说明怎么用 `bsk` 把基准抓下来。读链路看 `install-hook.js` 就够了；**写链路真正的难点是填表单**，
尤其是 antd 的日期区间选择器 —— 下面第二节是这份手册存在的理由。

## 0. 铁律

- **绝不从页面里提取凭据、cookie、token 或任何认证数据。** 你不需要它们：`bsk` 用的是用户
  已登录的浏览器会话，而脱敏是 `install-hook.js` **在页面内**完成的（`token` 头在离开浏览器前
  就被替换成 `<redacted>`）。这条没有例外。
  ⚠️ **URL 上的 token 也算 —— 而且这一条是 2026-09-21 才补上的。**
  `smart-layer-admin` / `smart-layer-app` 不靠请求头传 token，而是塞进 GET 参数
  （抓「讲师管理」那类页面时实测 25 处 `&token=eyJhbGciOi…`）。
  钩子当时只脱敏请求头，那 25 串**完整 JWT 就这么躺进了捕获缓存**。
  现在 `redactUrl()` 会把 URL 上带 token / ticket / sign / secret / access_key 的参数值一并换掉。
  抓完仍然值得**扫一眼**再落盘：`grep -c 'eyJ' 你的捕获文件` 应当是 0。
- 用 `bsk` 抓完必须 `bsk session stop <id>`，成功和失败路径都要。
- 提交类操作会真的写数据。会议名称用一眼看出是测试的名字，用完**在同一轮里撤销掉**。

## 1. 通用流程

```bash
bsk session start --no-focus                 # 记下打印出来的 4 位会话 id，后面每步都要 --session
bsk navigate "<页面 URL>" --session <id>
bsk evaluate --session <id> "$(cat tools/baseline/install-hook.js)"   # 返回 installed
# 在页面上触发一次真实请求（点击查询 / 填完表单点提交）
bsk evaluate --session <id> --json 'JSON.stringify(window.__phCap)'
bsk session stop <id>
```

`window.__phCap` 里每条都有 `via / method / url / headers / body`。抓请求体前可以
`bsk evaluate --session <id> 'window.__phCap=[]'` 清一次缓冲，这样只剩你要的那几条。

### 1.1 门户首屏有个「加载门禁」——直接进目标页会白屏，且**不发任何页面请求**

2026-09-21 抓「人工智能」域 16 页时踩到并复现的。

`bsk navigate` 直接打到目标哈希路径时，门户的外壳**经常卡在自己的**
`正在加载数据 / 如长时间停留，请刷新页面` 上：`#app[data-v-app]` 已挂载，但 bootstrap 停住，
**页面自己挂载时那条列表请求根本不会发** —— 于是你抓到的是空数组，而且容易误判成"这页没请求"。
实测（派单方复现）：单次 `navigate` 后 **20 秒仍是门禁态**（`body.innerText.length === 19`、无 `.ant-table`）。

**可用的配方**（16 页全程靠它）：**再导航一次同一个 URL**，同文档导航会把外壳启起来。

```bash
bsk navigate "<门户首页或目标页>" --session "$S"
bsk wait-ms 4000 --session "$S"
bsk navigate "<同一个 URL>" --session "$S"        # ← 关键：第二次，外壳才起来
bsk wait-ms 6000 --session "$S"
# 轮询到真的渲染出来，**这时才装钩子**
bsk evaluate --session "$S" '(()=>{const t=document.body.innerText;return String(!/正在加载数据/.test(t))})()'
bsk evaluate --session "$S" "$(cat tools/baseline/install-hook.js)"
# 再切到目标页（只改 hash），挂载请求就完整入捕了
bsk evaluate --session "$S" '(()=>{location.hash="#/目标路径";return "ok"})()'
```

实测对比：单次导航 → `{gate:true, table:false}`；二次导航同一 URL → `{gate:false, table:true}`。

**判断依据不要看时间，要看内容**：等到 `body.innerText` 里不再有「正在加载数据」、
且目标页的表格/容器已经出现，再装钩子。只按固定秒数等会等到空捕。

> 两条采集侧报告、**派单方尚未逐条复现**，先用着并留意：
> ① `bsk navigate` 走同文档哈希导航时 **RPC 可能稳定超时 30s**（但导航实际生效）——
> 可加 `--wait-until commit --timeout 8s`，或干脆用上面的 `location.hash=` 写法绕开；
> ② `bsk tab create` 开出来的新标签停在 `chrome://`，**无法用 bsk 驱动**。
>
> 另外注意：这个门禁现象**可能与并发会话有关**——同一次抓取里曾出现"单次导航就正常渲染"的情况
> （那次另一个子代理正在用同一个浏览器跑真机写入）。**浏览器是单实例共享资源，抓基准时不要并发**，
> 否则既会踩门禁，也可能把别人的请求混进捕获（见第 31 条那个"跨页状态泄漏"的同源风险）。

## 2. 怎么驱动 antd 日期区间选择器（写链路的核心）

会议室表单 `/simple/hr/form/033` 的「时间段」是 `a-range-picker` + `showTime`。
试过但**走不通**的路子，别再浪费一轮：

| 试过的方法 | 结果 |
| --- | --- |
| `bsk fill` | 报 `element BUTTON/SPAN not fillable` / `could not verify the expected value`（首次尝试时踩到，本次未复现） |
| 原生 setter 改 `input.value` + 派发 `input` 事件 | rc-picker 不认，表单不会提交这个值 |
| 从 `el.__vueParentComponent` 取 `formState` | 生产构建里拿不到 |
| `bsk press` 逐字符敲 | 没走到这步：readOnly 决定了敲键盘也改不了值（原因见下） |

**根因**：rc-picker 把输入框设成了 `input.readOnly = true`：

```js
// 页面上验证过
Array.from(document.querySelectorAll('input'))
  .filter(i => /开始日期|结束日期/.test(i.placeholder))
  .map(i => i.readOnly)   // => [true, true]
```

readOnly 的输入框收不到键盘输入，React 的受控值也只能靠 rc-picker 自己的面板状态改。
**所以必须点面板，不能填输入框。**

> **2026-09-20 更正（作业管理那条线实测）**：这条原本写成"**`showTime` 打开时** rc-picker
> 才把输入框设为 readOnly"，**不成立**。作业管理列表页的「创建时间」是**不带 `showTime`** 的
> `a-range-picker`，两个输入框**同样是 `readOnly: true`**。
> 正确表述是：**rc-picker 的输入框本来就 readOnly，与 `showTime` 无关**；
> `showTime` 只决定面板里多不多三列时间。
> 结论不变（必须点面板），但按旧说法去判断"这个日期控件要不要点面板"会判断错。

### 2.1 面板长什么样

点开开始日期输入框后（`bsk click 'input[placeholder="开始日期"]'`）：

- 页面里**只有一个** `.ant-picker-panel`（宽 449px），不是常见的「两个月并排」。
  它按「当前激活的输入框」切换内容：先显示开始侧，点了结束输入框之后才切成结束侧。

  > **2026-09-20 更正（作业管理那条线实测）**：「只有一个 panel」是**这个表单**的性质，
  > 不是通则。作业管理列表页那个**不带 `showTime`** 的区间选择器就是**两个 panel 并排**
  > （经典两月视图）；而它的新建页上，列表页那两个**不可见**的 panel 还留在 DOM 里，
  > 于是 `document.querySelectorAll('.ant-picker-panel')[0]` 拿到的**不是当前打开的那个**。
  > ⇒ 不要硬编码 `[0]`，筛可见的：
  > `[...document.querySelectorAll('.ant-picker-panel')].filter(p => p.offsetParent)[0]`。
- 一个 panel 内部是 `.ant-picker-date-panel`（日期表）+ `.ant-picker-time-panel`（三列时间）。
- 时间三列固定是 `.ant-picker-time-panel-column` 的 index 0/1/2 = **时 / 分 / 秒**，
  分别有 24 / 60 / 60 个 `.ant-picker-time-panel-cell`，且 0 基下标就等于数值
  （`cells[15]` 的文本是 `15`，即 15 时）。分钟只允许 00 或 30 是业务规则，面板本身 60 个都能点。
- 日期格的 selector：`.ant-picker-cell[title="2026-09-22"]`。
- 底部有 `.ant-picker-ok button`（「确 定」），**不点它值不会写进表单**。

### 2.2 可复用的操作配方

```bash
# 在页面里 scrollIntoView 之后打一个标记；然后按标记用真实鼠标点击
ph_pick () {  # usage: ph_pick '<返回元素的 JS 表达式>' <session>
  local expr="$1" sess="$2"
  # ⚠️ 先清掉上一次打的标记：bsk click 点的是「文档里第一个带这个属性的元素」，
  #    不清就会点到上一次那个（2026-09-20 作业管理那条线实测：以为点了行内「编辑」，
  #    实际点到了顶部「新建」）。加上这一句，见下面 §2.5。
  local js="(() => { try { document.querySelectorAll('[data-ph-t]').forEach(e => e.removeAttribute('data-ph-t')); const el = $expr; if (!el) return 'NOT_FOUND'; el.scrollIntoView({block:'center', behavior:'instant'}); el.setAttribute('data-ph-t','1'); return 'tagged:' + String(el.innerText||el.title||'').replace(/\\s+/g,' ').slice(0,30); } catch (e) { return 'ERR ' + e.message } })()"
  bsk evaluate --session "$sess" --json "$js" | grep '"value"'
  bsk click '[data-ph-t="1"]' --session "$sess"    # 用 CSS 选择器点，bsk 会在点击时重新解析
}
```

完整的一次「开始 → 结束 → 确定」，实测可用（`<P>` = `document.querySelectorAll(".ant-picker-panel")[0]`，
时间列 = `<P>.querySelectorAll(".ant-picker-time-panel-column")[n]`）：

```text
1. bsk click 'input[placeholder="开始日期"]'                          # 开面板
2. ph_pick '<P>.querySelector(".ant-picker-cell[title=\"2026-09-22\"]")'   # 开始日期
3. ph_pick '<P>.querySelectorAll(".ant-picker-time-panel-column")[0].querySelectorAll(".ant-picker-time-panel-cell")[14]'  # 14 时
4. ph_pick '<P>....[1]...[0]'                                        # 00 分
5. ph_pick '<P>....[2]...[0]'                                        # 00 秒
   # 此时「开始日期」输入框已是 2026-09-22 14:00:00
6. bsk click 'input[placeholder="结束日期"]'                          # 切到结束侧（面板内容会整个换掉）
7. ph_pick '<P>.querySelector(".ant-picker-cell[title=\"2026-09-22\"]")'
8. ph_pick '<P>....[0]...[15]'                                       # 15 时
9. ph_pick '<P>....[1]...[0]'
10. ph_pick '<P>....[2]...[0]'
11. ph_pick 'document.querySelector(".ant-picker-ok button")'        # 确定
```

每一步之后都值得用一次 evaluate 复核输入框的值：

```bash
bsk evaluate --session <id> --json \
  "(()=>JSON.stringify(Array.from(document.querySelectorAll('input')).filter(i=>/开始日期|结束日期/.test(i.placeholder)).map(i=>i.placeholder+'='+i.value)))()"
```

### 2.3 三个会让结果**静默错**的坑

1. **点时间格之前必须先 `scrollIntoView({block:'center'})`。**
   时间列是滚动容器，直接按标记点击会用到滚动前的坐标，点到的可能是**相邻一行**。
   症状极具迷惑性：面板上「结束时间」显示成了开始的 `14:00:00` 而不是 `15:00:00`，
   没有报错、`bsk click` 也回 `click ok`。上面的 `ph_pick` 就是为这个坑写的。

2. **`[data-ph-t="1"]` 这种「先打标记再点」的办法在 rc-virtual-list 里会失效。**
   antd `Select`（会议室下拉）的选项在虚拟列表里，点击时列表滚动/重渲染会把节点换掉，
   `bsk click` 报 `element not visible (no content quads, box model, or visible descendant bounds)`。
   会议室下拉改用键盘：`bsk click '.ant-select-selector'` 开面板 →
   `bsk press ArrowDown`（打开时 `option-active` 已经在第 0 项，按一次就到了第 1 项）→ `bsk press Enter`。
   另外，下拉面板的 innerText 里会带出选项 id（本次是 `4` / `5` 这种数字，来自一个隐藏的
   测量节点），选中后 `.ant-select` 的 innerText 直接变成 `5|博创小会议室` ——
   也就是说**数字 id 是页面自己告诉你的**，不用猜、也不要去翻接口。
   需要点非虚拟列表的东西（`提 交` 按钮、`.ant-picker-ok button`）时，标记法是好用的。

3. **`bsk click` 用 CSS 选择器比用 `@eN` ref 稳。** 大 DOM 变化后 ref 会漂，
   而选择器是在点击那一刻重新解析的。`bsk observe` 的输出在上千个菜单项面前也不好读，
   用 `bsk evaluate` 查 DOM 更快。

### 2.4 提交是两步

表单的 `handleSubmit()` 先 `POST .../getRequiredStartUserSelectTasks`，再 `POST .../create`。
两次请求都会进 `window.__phCap`，取基准时**要的是第二条**。第一步的 body 是同一份载荷
去掉 `startUserSelectAssignees`。

写链路的基准在 `baseline/meeting-application-write.browser.json`，
对应的回归测试是 `test/baseline-write.test.ts`。

> 这一步是**会议室那条流程线专有**的。普通 CRUD 页面（作业管理）的提交就是一次 POST，
> 没有"先问一次"的前置请求，取基准时不要照着这条去找第二条。

### 2.5 作业管理那条线补的三条（2026-09-20）

1. **平滑滚动会让时间列点偏一行。** 就算按 §2.3-1 加了 `scrollIntoView({block:'center'})`，
   它触发的**平滑滚动**也还没结束，`bsk click` 用的还是滚动稳定前的坐标。
   实测：想点 18 时，结果选中了 19 时；没有报错、`bsk click` 回 `click ok`。
   ⇒ 用 `scrollIntoView({block:'center', behavior:'instant'})`，**并等一拍**再点。
2. **标记要清。** 见 §2.2 里 `ph_pick` 的注释：`[data-ph-t="1"]` 是"文档里第一个"，
   不清理上一次的标记就会点到上一次那个元素。
3. **`bsk fill --value <值> <选择器>` 在普通文本输入框上是好用的**（Vue 的 `v-model` 认），
   只有 antd 的日期/下拉要绕。本手册 §2 表格里"`bsk fill` 走不通"那条是**针对日期选择器**说的。

写链路的基准（读 2 份 + 写 1 份）在 `baseline/assignment-list.browser.json`、
`baseline/assignment-list-daterange.browser.json`、`baseline/assignment-write.browser.json`，
对应的回归测试是 `test/assignment.test.ts`。

## 3. `convertFetchForm`：卡住那 69 页的就是它

**先看这条为什么值钱。** 生成器只扫页面源码里的 `getDataListURL`，看不到页面挂的改写函数，
所以把这类页面判成 `partial/contract`。全量 241 个声明式列表页里 **69 页命中 `convertFetchForm`，
而 `auto` 桶里 0 页** —— 它就是"需人补"那 112 页的主要成因。也就是说：**把这一节做顺，
后面几十页是同一套动作。**

> 数字随清单变：2026-09-21 之前是「255 页里 72 页」（见 `docs/conventions.md` 第 28 条
> 那次修正，清单从 1019 降到 975）。以后引用这几个数请现算，别抄这句。

### 3.1 它是什么

renren 的列表模块暴露的一个钩子，挂在 `rrList` 上，**改的是列表查询参数**（不是提交载荷）：

```js
rrList.convertFetchForm((data) => ({ … }))
```

它拿到的是表单的 `formState`，返回的是**真正发出去的 query**。所以读契约的正确姿势是：
**读这个函数的返回值，而不是读 `form:` 的初值** —— 两者可以毫无重叠。

### 3.2 三个必看的点

**① 返回值里没有的字段，一个都不会发。**
课程域图文课程页的 `form` 是 `{ keyword: '', date: [] }`，而 `convertFetchForm` 返回的是
`{ keyword, startTime, endTime }` —— `date` 不见了，多出来两个标量。谁被拆开、谁被丢掉，
只能读这个函数。

**② 空值是空字符串，不是省略。**
实测：无筛选时浏览器照样发 `keyword=&startTime=&endTime=`。
`src/http/client.ts` 用 `qs` 的 `skipNulls`（跳过 `null`/`undefined`），**不跳空串**，
所以能力侧要把初值写成 `''` 而不是 `null` —— 写成 `null` 会被丢掉，URL 就与基准不一致了。

**③ 日期区间的改写规则要逐页读，不要照抄隔壁。**
同一个域里的四页都可以不一样（课程域：三页是 `keyword + startTime/endTime`，
即时通讯那页是 `keyword + numberMin/numberMax/status + createTime*/deleteTime*`）。
**结束日 +1 天**（`.add(1,'day').startOf('date')`）是多数的做法，但不是全部 ——
读源码原文为准。

### 3.3 抓基准的动作序列（实测可用，2026-09-21）

```bash
bsk session start --no-focus                      # 记下 4 位会话 id
bsk navigate "<页面 URL>" --session <id>
# 等高 5~6 秒（SPA 挂载 + 首屏请求）
bsk evaluate --session <id> "$(cat tools/baseline/install-hook.js)"     # 返回 installed
# 触发一次真实请求（下同）：点「查询」
bsk evaluate --session <id> --json '(()=>{const b=[...document.querySelectorAll("button")].find(x=>/查\s*询/.test(x.innerText)); b.setAttribute("data-ph-t","1"); return "ok";})()'
bsk click '[data-ph-t="1"]' --session <id>
sleep 3
bsk evaluate --session <id> --json 'JSON.stringify((window.__phCap||[]).filter(e=>/关键字/.test(e.url)).map(e=>e.url))'
bsk session stop <id>
```

⚠️ **钩子要装在被触发的那条请求之前**，所以是「navigate → 装钩子 → 点查询」，
**不是**「navigate → 点查询」。`bsk reload` 会把钩子连同页面上下文一起清掉，别用它。
（首屏挂载时自动发出的那条请求抓不到，用点「查询」补一条等价的即可 —— 实测两者 URL 完全相同。）

### 3.4 往里填值的两条路

- **普通文本输入框**：`bsk fill` 可用（Vue 的 `v-model` 认）。若手上只有 CSS 选择器，
  用原生 setter + 派发 `input` 事件也行：

  ```js
  const i = [...document.querySelectorAll('input')].find(x => x.placeholder === '关键字')
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  set.call(i, '蛋鸡')
  i.dispatchEvent(new Event('input', { bubbles: true }))
  ```

- **antd 日期区间**：走 §2 那一整套（点面板，不能填输入框）。
  课程域这四页的区间选择器是**不带 `showTime`** 的，实测**有两个并排的 panel、且没有
  `.ant-picker-ok`**（点完第二天就自动生效）—— 与 §2.1 里那个带 `showTime` 的表单不同，
  别照抄 §2.2 那份必须点「确定」的流程。

  ```js
  // 取可见 panel（不要硬编码 [0]，见 §2.1 的更正）
  const p = [...document.querySelectorAll('.ant-picker-panel')].filter(x => x.offsetParent)[0]
  p.querySelector('.ant-picker-cell[title="2026-09-15"]')
  ```

### 3.5 落盘与回归

抓到的东西写进 `baseline/<页面>.browser.json`（格式照抄 `baseline/attendance-statistics.browser.json`），
测试里用**有序的 [key, value] 列表**比对，这样**键顺序的差异也会被发现**
（`test/baseline.test.ts` 的 `queryPairs` 就是干这个的）。

**键顺序不是洁癖。** 课程域这一轮就撞上了：页面把 `type` 拼在 `getDataListURL` 上，
浏览器发出的顺序是 `…&pageSize=20&_t=<ts>&type=1`，而 SDK 的 client 当时把 URL 上的 query
合在 params **之前**，会排成 `type=1&order=…`。两种排法在**不冲突时只差键序**，
在**键冲突时差的是谁赢**（前端 `platform.js:57-62` 是 inline query 在后、赢）。
修法与反证见 `docs/pages/图文课程.md`。
