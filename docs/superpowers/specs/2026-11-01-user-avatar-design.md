# 用户头像设计

日期：2026-11-01

## 概要

普通用户的头像由系统内置头像或自定义上传头像组成。所有现有用户和新注册用户都会自动获得一张系统头像；用户只能在 Dashboard V2 的个人资料页随机更换或上传自定义头像，不能浏览和指定系统头像。桌面端只负责展示。

本期不修改 Dashboard V1、SynapseMobile 或 iOS/iPadOS。

## 系统头像

- 来源素材共 3448 张，经下载清单与含糊素材的图片核对后，仅保留 1885 张真实动物头像（含鸟类、鱼类及无脊椎动物），格式为 `512×512` WebP，质量 86。物品、植物、机器人和幻想角色不进入系统头像目录。
- 对象存储 key 固定为 `avatars/system/v1/512/<filename>.webp`。
- `SystemAvatar` 表保存稳定 ID、对象 key、相对公开 URL、MIME 和排序。
- 现有用户通过数据库迁移随机绑定一张头像；新用户在同一注册事务中随机绑定。
- 随机更换从除当前系统头像外的所有系统头像中选取；当前为自定义头像时从全部系统头像中选取。
- 不提供系统头像列表或按 ID 设置的客户端接口。
- `20261102113000_animal_system_avatars` 迁移先逐人随机替换非动物系统头像，再删除目录中的非动物记录；已有动物头像和自定义头像保持不变。迁移在同一事务内锁定目录与用户表，禁止用不关联用户的随机 LATERAL 查询批量赋值。非动物对象在目录清理成功且图片已备份后从 Platform Media COS 删除；历史初始迁移不得修改，后续不得重新导入完整素材库。

## 自定义头像

- Dashboard V2 使用 `react-avatar-editor` 裁剪，输出 `256×256` PNG。
- 对象存储 key 为 `avatars/users/<assetId>.png`。
- 服务端只接受不超过 1 MiB、PNG 签名正确且 IHDR 为 `256×256` 的请求体。
- `UserAvatarAsset` 保存对象 key、URL、类型、大小、状态和删除重试信息。
- 新对象完成上传并切换用户引用后，旧自定义对象标记为待删除；COS 删除失败由定时清理继续重试。
- 用户随时可以点击“随机头像”切回系统头像，旧自定义对象按同一流程清理。

## 用户数据

`User` 保存以下冗余引用，以便资料接口和桌面缓存直接读取：

- `avatarUrl`：相对应用公开地址，例如 `/api/avatars/system/<id>`。
- `avatarSource`：`system` 或 `custom`。
- `systemAvatarId`：当前系统头像引用。
- `customAvatarAssetId`：当前自定义头像资产引用。

业务接口保证两个当前引用最多只有一个有效，不开放客户端直接写 `avatarUrl`。

## 公开读取与缓存

- `GET/HEAD /api/avatars/system/:id`
- `GET/HEAD /api/avatars/users/:id`

这两个接口不需要登录，由服务端从私有 Platform Media COS 流式代理并返回跨源图片头。资源 URL 包含稳定系统 ID 或一次性资产 ID，因此使用一年 immutable 缓存和 ETag；不暴露 COS bucket、key 或永久凭据。

## 编辑接口

- `POST /api/console/me/avatar/random`
- `PUT /api/console/me/avatar`，请求体为原始 PNG 字节，`Content-Type: image/png`

两个接口均返回完整 `UserMeResponse`，资料中的 `avatarUrl` 使用相对公开 URL。桌面主进程负责把它解析为完整 URL 后交给 renderer。

## 界面

### Dashboard V2

- 侧栏顶部显示头像，名称优先使用昵称，其次用户名和邮箱。
- 个人资料页提供头像预览、“随机头像”和“上传头像”；两个操作即时保存，不依赖下方资料表单的“保存”。
- 成功后同时更新 `dashboard-me` 查询和 auth store，侧栏立即刷新。

### 桌面端

- 顶栏账号按钮、账号菜单摘要、设置页账号卡片显示同一头像。
- 图片加载失败或旧缓存没有 URL 时回退到通用用户图标。
- 头像写入后通过现有桌面 Live 通道通知该用户的在线客户端立即同步资料；Live 不在线时，窗口每次重新获得焦点仍会静默同步账号资料。同一时刻只保留一个资料同步请求。

## 非目标

- 不允许用户选择指定系统头像。
- 不提供无头像状态。
- 不把头像字节写入 PostgreSQL。
- 不修改 Dashboard V1、移动端、公开用户资料页、评论或团队成员的其它展示面。
- 生产数据迁移和对象清理需单独授权，不随头像界面开发自动执行。
