# 三种比例牌桌实施计划

用户已要求直接实施；本会话依次完成，不重复请求执行确认。

1. `lib/table-scene.ts` 集中定义 `TableScene`、`fitTableScene(width,height)`、`tableSceneVariables(scene)`。先写几何回归，验证三种比例、零尺寸、完整 contain、2—10 座的座位/中心/下注边界。
2. `components/Table.tsx` 根据现有 ResizeObserver 的 viewport 测量选场景；模式加入布局身份，批量按帧更新并清理待执行帧。座位保留现有映射，场景变量统一控制位置，筹码动画继续测量实际锚点。
3. `styles/adaptive-table.css` 在现有模块样式之后提供场景布局与材质。取消该场景的逆缩放文字和座位宽度，仅几何数据使用动态 style。保留颜色、卡牌素材、reduced motion 和画布外操作区。
4. 同步模块边界、Agent 指南和旧专题的固定画布说明。游戏改动按仓库规则不写发布说明。
5. 验证：扑克专项测试、desktop typecheck、hard constraints、相关 lint。使用实际组件的静态渲染与模块 CSS 检查三种场景、满座及结算，记录尺寸和遮挡检查结果；不启动正在运行的应用或开发服务器。
6. 比较任务开始时保存的文件内容与最终 diff，仅将本任务增量暂存并本地提交，不 push。

重点回归：同 scale 切换场景、未测量/零高、本人视角旋转、十人竖桌、结算提示与下注互斥时序、日志开合、observer 卸载清理。
