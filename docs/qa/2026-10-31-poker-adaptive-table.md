# 三种牌桌场景验收

2026-10-31，仓库 `/Users/liyang/Documents/code/github/Synapse`，开发分支 `main`。未启动 Synapse、开发服务器或真实牌局，未部署、未调用业务写接口。通过离线构建的真实 React 组件及原始 CSS、卡牌素材验收，ResizeObserver 及画布外操作区均实际运行。

## 尺寸与选择

横向 1440×900，方形 1080×1080，纵向 840×1320。对扣除顶栏/操作区的 viewport 选择场景，切换边界由相邻画布比例的几何平均数导出，约 1.265 和 0.798；在三个候选画布中优先占用更多可用面积。每套场景均 contain 等比缩放，座位、卡牌、金额及文字共用缩放，不逆缩放局部字号或座位宽度。

几何测试覆盖每套场景的 2—10 座，包括旋转后本人位置、下注与选手/中心分离、本人结算边界、隐藏/零高/非有限尺寸。接入测试覆盖同 scale 切换场景、日志开合、同帧测量合并及卸载取消。

## 实际组件布局

9 种窗口：1728×1028、1192×1028、570×1028、1280×720、1024×768、850×700、720×900、500×800、440×650。每种测试 2、5、6、10 座，分别进行中/结算，共 72 组：24 横桌、32 方桌、16 竖桌。

实际测量选手/公共牌/下注/结算 DOM 边界、viewport 裁剪及百万筹码宽度，72 组未检出上述重叠、裁剪或金额溢出。静态渲染初查发现方桌本人长结算碰到相邻座位，及百万筹码宽度不足，已分别通过限制结算宽度并换行、调整座位与金额排版修正。真实组件验收重新检查了这些情况。

离线真实组件构建入口：`/Users/liyang/.codex/visualizations/2026/10/31/01a19029-f3f1-7432-a1e8-a284d120ae5f/table-check/index.html`（本地，无在线链接）。其中 `window.checkLayout(width,height,count,settled)` 可切换验收场景，不连接游戏 API。构建使用项目已有 Vite，无新依赖；临时构建入口和静态渲染测试生成器已移除。

## 检查结果

- 扑克专项 21 文件、141 项通过。
- desktop typecheck、hard constraints、相关 TS/TSX eslint、diff 空白检查通过。
- desktop 全量：1153 文件通过、2 文件跳过、1 文件失败；11758 项通过、2 项跳过、1 项失败。失败为 `mobile-workspace-files-service.test.ts` 的 `reads multiple baselines beside unrelated loose objects within independent budgets`（551 行 contentState 断言）。本任务未修改该模块；该用例随后单独重跑通过，不将整次全量记为通过。原始日志 `/tmp/synapse-adaptive-desktop-tests.log`（本地，无在线链接）。
- 独立源码审查未发现阻断问题，覆盖场景身份、坐标根、动画清理和旧 CSS 覆盖。

未验证真实多账号联网牌局、正式打包或生产环境。只改变 Renderer 场景与材质，未修改 MCP/IPC/schema、权限、资金或操作协议；游戏改动不进入发布说明。
