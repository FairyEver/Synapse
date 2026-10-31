# 德州扑克真实质量检查 · 阶段性交付

日期2026-10-31。仓库 `/Users/liyang/Documents/code/github/Synapse`，始终在main；起点93411af1848b8652c10fd3572b9081becd7fbc53，开始工作区及暂存区干净。复用已运行Synapse 1.0.93 dev、Vite、服务和本人登录态；没有部署、发布、push、迁移业务库、直接查库、修改APNS或使用其他账号。

**没有满足全部结束条件。** 实际完成14手和多轮修复。最后发现并修复“历史座位阻止重新入座”，自动化通过，但此修复后没有打完3手，也没有完成实际重新入座闭环。第二房首手超时，不能算成通过。不宣称两轮最终完整检查或所有动效验收通过。

## 实战与安全收尾

独立陪练房389316（QA1031），标准52张、1/2、六座、1000练习筹码；先两位程序机器人，后五位机器人满桌。本人既通过桌面操作，也由当前Codex通过真实MCP控制。**实际模式是本人由AI控制，与程序机器人对战**；没有第二真人或独立AI对手，机器人不调用模型。

|手|实际体验|净变化|
|---|---|---|
|1|桌面加注到9（追加7）、翻牌下注2、全下取消；桌面申请AI，MCP版本2接管，转河过牌|-11|
|2、3|MCP分别84杂色、72杂色弃牌|-1、0|
|4|本人接管版本3，wait返回control_released；桌面逐街过牌|-2|
|5|申请手后暂离、跟注3、翻牌弃牌，实际sitting_out；主池12、边池4|-4|
|6|六人桌半池加注到8，对手弃牌；热重载影响完整观看|+9|
|7|恢复房间，旧AI版本2真实act被POKER_CONTROL_RELEASED拒绝；桌面弃牌、实际暂离|0|
|8|小窗口加注到6，赢池7、返还4，结算到下手连续采集|+5|
|9|两次跟注2、翻牌下注2、转河过牌、河牌再跟注2；对手两对赢40|-8|
|10|真实reduce模式，AA确认全下986；赢池12、返还986，实际暂离|+10|
|11|滑杆End到998，确认取消后焦点返回原加注；半池加注到8（追加7）、翻牌弃牌，对手赢48|-8|
|12|桌面申请版本4，MCP认领版本5；98同花跟注2，逐街过牌完成摊牌|-2|
|13|MCP A7加注到8；主池5、边池4、返还6|+7|
|14|MCP94杂色弃牌，手后实际暂离；本人接管版本6并离桌|0|

历史通过hand_history(mode=practice,limit=14)核对。首手d06cd1fc-46bf-41c8-8060-ad50fc4ff217，末手43085464-976e-4045-bdb4-4ae57cfbe1ad。第3、7、14手delta=0，服务端result=split，但本人实际未投入即弃牌，**不当作平分底池证据**。

第二独立房799575（QA1031-Rejoin）为两座、1机器人，同规则/带入。首次MCP入座前核对requiresJoinApproval=false；首手恢复操作期间触发600秒超时，自动过牌并离场，后续wait返回table_closed及lastAutoAction=timeout。未绕过历史授权重新入座。

最后权威核对：大厅总/可用点数均1,000,000，inPlay=0、netProfit=0、sessions=[]。389316已closed、本人无座位、控制历史版本6、handoffPending=false；799575为paused、本人无座位、controller=null、handoffPending=false。没有未确认提交或AI控制循环。第一房离桌前练习筹码995，未兑换点数。原用户资源未删除。

## Before / After：全部改动

### 布局与可读性

|Before|After、根因与验证|
|---|---|
|筹码使用近似座位坐标，在手牌后方移动，终点不对应静态下注|ChipMotion测量真实seat plate、wager和pot；统一缩放坐标，运动层不拦点击。07原始帧复现，后续帧保留；完整流畅度仍待补验|
|下注数字挤在座位状态行|本轮下注独立放在内侧锚点；settled隐藏静态下注，避免与派彩同时占用|
|新增追加说明占一整行，进一步压缩牌桌|追加预览合并进金额label，保持原控件区占位|
|小窗口文字过小，放大后两排相撞|按canvas scale维持姓名12px、筹码14px、下注12px，座位最小可见宽74px；短窗口两排拉开。仍为1440×900 contain|
|结算随画布缩小、顶部手牌压住摘要|摘要移出缩放画布，保持正常字号并固定预留上方空间|
|新赢家净变化标签压住下一位手牌|对手标签移到对应座位外侧；39号同类真实小窗口结算确认不再挡牌；本人标签在本人下方|

### 操作、状态与可访问性

|Before|After与实际验证|
|---|---|
|只显示加注总额，快捷金额无选中|总额与追加同时可读，aria-pressed标记预设，数字稳定；实际998总额/997追加、996总额/994追加已验证|
|提交中仅禁用按钮|busy显示“正在提交…”；成功收据只随权威快照。未知动作原actionId重试、失败保留草稿的既有机制保留|
|取消隐式全下焦点回显式全下，成功也可能抢焦点|只在主动取消时恢复实际触发按钮；36号原始截图与AX核对返回“加注998”|
|settled后的waiting显示“下一手加入”|优先显示“本手结束”|
|亏损与盈利同样金色，返还可能混同赢池|摘要亏损用普通前景；座位分别显示赢池、返还、净变化；第10手12/986/+10已核对|
|离桌后上手历史座位仍导致本人入座禁用|去掉以投影seats.length裁决实际容量的判断，交服务端核定；105测试通过，实际重新入座尚未闭环|
|离桌历史本人仍标AI操作|按mySeatNo=null标“已离桌”，解散房间仍关闭操作；最后此项未打新三手|

### 动效与时序

|Before|After、触发、完成与中断|
|---|---|
|events和table两路轮询猜测收池，漏盲注|权威table单一时序，按handId/actionSeq去重；实际amount表示追加，归集为上一快照投入+新增动作，含盲注；events继续服务日志|
|初载visible=0，重进重发牌|初载直接当前牌面；之后新手/新增公共牌才55ms逐张显现，保留已有transition；超过3秒断流或后台直接同步|
|只有常驻轮次边框|新轮次一次360ms座位提示，行动区指示点160ms过渡，不无限闪动、不夺焦点|
|下注、收池、派彩同一近似路径，900ms易混叠|确认下注340ms到wager，之后240ms归集；合法结算按pot.shares派彩，520ms起步、每池错开80ms，返还单列；跨街优先最新状态，不积压到下手|
|赢家缺少座位关联|结果先静态可见；仅本人赢池且delta>0时800ms短庆祝，平分/返还/净亏损不误庆祝。完整庆祝过程仍待验收|
|切换可能残留旧运动|身份、视角、控制、布局、跨手和visibility变化建立基线/清理；反馈1400ms有界释放；资金、控制、倒计时不依赖动画回调|
|辅助界面直接显现|日志和动作收据160–180ms淡入；保留40px按钮、0.96按压和focus。无新增依赖、transition:all或全局设置|
|缺少真实减弱效果验证|当前窗口Rendering仿真reduce，核对matchMedia=true、卡牌transition=0s、筹码display=none；第10手实际全下至结果，静态标识和金额保留。仿真已清除，调试器恢复原停靠并关闭，窗口恢复宽尺寸|

## 原始证据与时间过程限制

证据目录：`/Users/liyang/.codex/visualizations/2026/10/31/01a18f5a-8088-7b33-b60e-ce88c0de3a28/poker-quality/`。无在线链接。manifest.json记录1027个原始PNG/JSON文件的SHA-256；原样移动，未编辑、生成或拼图。每段*-timeline.json记录采集时间。约153MiB原始帧留本机，不加入Git历史。

|场景|文件前缀/名称|
|---|---|
|首次、空房、机器人、本人入座|01-before-lobby、02-before-empty-room、03-before-bot-management、04-before-seated|
|行动、编辑、全下、AI|05-before-your-turn-edit、06-before-allin-confirm、08-before-ai-request、09-before-ai-controlled|
|原路径问题与新下注|07-before-raise-*、17-after-raise-collect-*、23-final-small-raise-*|
|小窗口问题与最后位置|18-before-small-window-readability、19–21为中间回归问题，不能当最终合格图；39-final-opponent-label-clear是最后标签位置|
|归集、公共牌、轮次、结果|24-final-call-flop-*、26-final-collect-flop-*、27-final-bet-turn-*、28-final-turn-river-*、29-final-showdown-payout-*、30-final-settlement-payout-*|
|金额、确认、键盘|22-final-small-bet-editor、25-final-implicit-allin-confirm、36-final-slider-cancel-focus|
|减弱模式|31-reduced-motion-emulation、33-reduced-deal-*、34-reduced-allin-result-*|
|日志、管理、重连、收尾|42-final-small-log、43-final-small-bot-manager、44-final-reconnect-no-replay-*、45-final-wide-safe、46-final-left-table|

工具操作与采集存在延迟，41-final-ai-raise-win实际已经进入第14手，不能作为第13手派奖实录，原样保留。本人获胜/返还静态金额、阶段推进、重进稳定显示已核对；**本人筹码飞行/庆祝完整触发—中途—结束，以及所有快速动作流畅度尚未完整验收**。无原生短录屏，不声称60fps。图片漂亮、代码存在和自动化夹具都不代替此项。

## 验证、失败尝试与剩余工作

- 最终游戏模块：20文件105测试通过。新增首载/断流、含盲注归集、连续追加、平分/边池/返还/净亏损、去重及历史座位重新申请入座回归。首载/收池曾先3项红灯，断流和再入座也分别先红后绿。
- 服务端engine、projection、bot-policy专项：5文件51测试通过。低概率平分、赢池但净亏损是合成夹具，未伪称真实UI。
- Renderer与test TypeScript检查、架构硬约束、生产改动ESLint、git diff --check通过。未跑全仓全量测试、正式包构建或性能基准；主进程、preload和服务端未修改。
- 执行命令：`pnpm --filter @synapse/desktop exec vitest run src/modules/game-hall --maxWorkers=4`；`pnpm --filter @synapse/server exec vitest run src/game/poker/engine src/game/poker/__tests__/projection.spec.ts src/game/poker/__tests__/bot-policy.spec.ts --maxWorkers=2`；desktop内`tsc -p tsconfig.json --noEmit`、`tsc -p tsconfig.test.json --noEmit`；`pnpm --filter @synapse/desktop run check:hard-constraints`。
- 结算文案旧断言“本手+30”曾失败，更新为明确净变化后通过。开发HMR曾回到默认聊天；DOM结构变化后旧尺寸观察器短暂失效(scale=0)，只读Console核对尺寸，重新进桌恢复，不修改游戏数据。失败采集与第二房超时不当成功。
- 仍需：在新独立房用桌面完成“入座→一手→真正暂离→离桌→历史结果仍在→再次入座”，并在最后代码版本至少完成3手及两轮完整检查；补严格同步成功下注、归集、本人派彩/庆祝的时间过程；补真实失败重试和网络恢复。当前两房无座位/交接授权，不得用旧版本MCP裸join。
- 快捷金额截上限、短筹码跟注耗尽、满房拒绝、失败保留编辑并非都已真实UI验证；不同赢家平分、十人满桌、长名称/极大金额、屏幕阅读器、第二真人/独立AI对手仍未覆盖。
- 修改MCP/IPC与系统Skill协议的必要性已核对：本次不改变其契约；同步游戏指南、模块边界、待发布说明。容量校验继续由服务端执行，不降低权限或唯一座位约束。

后续先重读Skill、guide、overview和当前state，不能沿用过期控制权。回滚为逆向本地提交，无数据库、部署或资金回滚；旧Renderer将恢复本次已记录的交互问题。
