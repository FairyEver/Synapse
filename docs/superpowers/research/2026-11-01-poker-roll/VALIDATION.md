# 验证记录

本任务只新增离线研究程序、合成数据与文档；未接入产品、修改业务数据库或部署。仓库 `/Users/liyang/Documents/code/github/Synapse`，发生修改时分支 `main`；不创建分支／worktree、不push。

- `pnpm --filter @synapse/server exec vitest run --config test/poker-roll-research/vitest.config.mts --maxWorkers=1`：7个文件、40项通过，15.70秒。覆盖精确概率、资金／牌量、原引擎对照、隐私、连续档位、历史匹配、恢复和指纹拒绝。
- `pnpm --filter @synapse/server exec tsc -p test/poker-roll-research/tsconfig.json`：通过。
- 默认产品测试发现检查 `vitest list test/poker-roll-research --json` 返回空数组；研究检查仅在独立配置下运行，不给浅克隆产品CI增加历史Git对象依赖。
- 原内核与缓存768组完整配对结果SHA相同，见 `memoization-parity.json`；恢复测试核对固定样本不变、新增行与原内核一致、样本上限不变。
- 完整数据链验收通过：538份索引原始文件，共2,212,032条研究记录（含训练、校准、主检验及独立诊断）；核对全部产物哈希、原内核、补充执行路径、模型／fit和旧数据前缀。见 `artifacts.json`、`completion.json`。442,368行切换检查点当时的321份／815,808行校验保留为历史记录，不作为最终总量。
- 6144个多人先手资金匹配预检全部精确匹配，最多4次入座重放，见 `multi-history-preflight.json`。浅筹码首次试算不足的失败、当时源码和清单保留在 `attempts/`，修正仅重建下一次入座资本，没有中途补款或放宽断言。
- 训练与固定检验各110592行的组内种子重复均为0；跨阶段按牌组／原始入座人数／种子识别底层手牌，各独立阶段之间交集0。固定集全局种子不重复；训练有14次跨不同牌组／人数的32位种子复用，已披露。见 `seed-audit.json`。
- 自适应部分保留7个组内重复种子簇，按整手种子及G/(G−1)稳健标准误另做复核；相同z／误差目标仍0/54达标，未覆写冻结统计、未删除／重抽数据。数值公式回归通过，完整重复ID与结果见 `cluster-audit.json`。

服务端广泛回归执行两次，明确不声称全绿：

1. 首次213个文件，2286项通过、137跳过、3失败；涉及drive浏览历史连接重置与lobby modes。两个文件隔离重跑33项全部通过。
2. 第二次215个文件，2296项通过、137跳过、2失败，均位于 `src/open-api/open-api-contract.spec.ts`，包括响应schema及 `#/$defs/__schema0` 悬空引用。该时间工作区另有OpenAPI／云表等并行改动，本任务没有修改这些生产模块。保留失败，不扩大本任务去修其他工作。

广泛测试使用空 `GAME_E2E_DATABASE_URL`，没有执行业务库E2E或迁移。命令、日志留在本地忽略目录 `/Users/liyang/Documents/code/github/Synapse/.superpowers/sdd/2026-11-01-poker-roll-research/`，尚无在线链接。主要日志：`current-unit.log`、`current-typecheck.log`、`server-full-final.log`、`server-failures-isolated.log`、`full-final.log`、`resume-full.log`。研究结果本身全部随此目录保存，可用README命令复跑及核验，不依赖忽略日志才能使用。

正式推断只取预先固定的2048/组，追加数据仅作分组精度诊断。是否通过统计门槛请读取REPORT，测试通过不代表模型平衡。

独立NumPy统计复核：1000次整手分层bootstrap（PCG64种子2026110191），固定样本均值和标准误与JS一致；普通／超级下界44.6537／94.4632 BB，见 `independent-stats.json`。未改变原检验门槛或调参。

正式行 `final-holdout:standard52:6:flop:0` 重放与原始记录完全一致，`audit-trace.jsonl` 的120条资金状态全部守恒；4个状态分支包含暖场，3条续局完成结算。详见 `replay-verification.json`。

主研究：54组均达到32,768起点上限，共1,769,472条；正式固定110,592条的净收益门槛通过，但冻结与聚类复核均0/54精度达标，`model-status.json`明确标为未验证候选。个人顺序13,824个起点固定其他座位的档位策略，六条本人路径独立比较。原模型／失败证据保存，新 `revision-candidate.json` 尚未验证，不用于产品。

独立审阅已核对源码、实际统计、整手聚类公式、资金账本、图表、报告链接与结论：可交付本轮研究及失败结果，不能视作上线定价批准。未执行生产集成、迁移、部署或push。
