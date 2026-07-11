# Skill 卸载器独立图标设计

## 目标

将用户桌面上的 `skill卸载器.png` 作为 Skill 卸载器系统应用的独立图标，停止复用 Skill 安装器图标。

## 资源归属

- 源文件：`/Users/liyang/Desktop/skill卸载器.png`
- 目标文件：`desktop/app-capabilities/skill-uninstaller/renderer/assets/icon.png`
- 使用移动语义：接入完成后桌面不保留源文件。
- 图标只属于 Skill 卸载器能力包，不放入公共应用资源目录，也不修改 Skill 安装器图标。

## 接入方式

`desktop/app-capabilities/skill-uninstaller/renderer/app-manifest.ts` 从同一能力包的 `assets/icon.png` 导入图标。其它系统应用注册、定义和渲染逻辑保持不变。

## 验证

- 先补测试，证明 Skill 卸载器与 Skill 安装器不再引用同一个图标资源。
- 验证目标 PNG 存在且为 256×256 RGBA PNG。
- 运行系统应用 registry 相关测试、类型检查和差异检查。
- 验证桌面源文件已不存在，仓库目标文件存在。

## 非目标

- 不调整图标内容、尺寸或配色。
- 不修改 Skill 安装器及其它系统应用图标。
- 不改系统应用布局、名称或功能。
