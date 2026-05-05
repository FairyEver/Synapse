# 激活码预绑定邮箱

## 概述

在后台创建激活码时，允许为激活码预设一个固定邮箱，使得只有该邮箱的用户才能兑换此码。支持定向发放（单个用户专属码）和批量预分配（一组邮箱各一个码）两种场景。

## 需求

- 创建激活码时可选填预绑定邮箱（不填则为通用码，保持现有行为）
- 批量创建时支持两种模式：统一邮箱（所有码绑同一邮箱）或邮箱列表（每个码对应不同邮箱）
- 预绑定邮箱仅做格式校验，不要求系统中已存在对应账户
- 一个邮箱可以拥有多个激活码（现有系统已支持）
- 邮箱不匹配时直接拒绝，提示"此激活码已分配给特定用户"，不透露具体邮箱

## 数据层

### Schema 变更

`ActivationCode` 表新增字段：

```prisma
model ActivationCode {
  // ... 现有字段
  reservedEmail String? // 预绑定邮箱，规范化存储（小写 + trim）
}
```

不需要索引——查询场景是通过 codeHash 找到激活码后读取 reservedEmail，不需要反向查询。

## 兑换逻辑变更

### 位置

`server/src/licenses/licenses.service.ts` — redeem 方法，在绑定检查（boundAccountId）之前插入。

### 逻辑

```
if activation.reservedEmail 不为空:
  将 request.email 规范化（小写 + trim）
  if 规范化后的邮箱 !== activation.reservedEmail:
    记录尝试（outcome: reserved_mismatch）
    评估风控
    抛出 ActivationError("ACTIVATION_RESERVED_MISMATCH", "此激活码已分配给特定用户。")
```

### 风控集成

新增 outcome 枚举值 `reserved_mismatch`，纳入现有的 `evaluateCodeRisk` 评估。多次不同邮箱尝试同一个预绑定码，应触发风控锁定。

## 后台创建接口变更

### API

`POST /admin/api/activation-codes`

请求体新增可选字段：

```typescript
{
  maxDevices: number
  expiresAt?: string
  quantity?: number          // 默认 1
  reservedEmail?: string     // 统一邮箱模式：所有码绑定同一邮箱
  reservedEmails?: string[]  // 列表模式：每个码对应一个邮箱
}
```

约束：
- `reservedEmail` 和 `reservedEmails` 互斥，同时传则 400
- `reservedEmails` 长度必须等于 `quantity`（或不传 quantity 时自动推断为列表长度）
- 邮箱格式校验（基本的 @ 和域名检查）

### 服务层

`server/src/admin/admin.service.ts` — `createActivationCodes` 方法：
- 接收 reservedEmail/reservedEmails 参数
- 规范化邮箱（小写 + trim）
- 创建激活码时写入 reservedEmail 字段

## 后台前端变更

### 创建表单

`server/admin/src/pages/activation-codes-page.tsx` — 创建对话框：

- 新增可折叠区域"预绑定邮箱（可选）"
- 展开后显示两种模式切换：
  - "统一邮箱"：单个 input，所有码绑定同一邮箱
  - "邮箱列表"：textarea，每行一个邮箱
- 邮箱列表模式下，quantity 自动设为邮箱行数（禁用手动输入 quantity）
- 前端做基本格式校验

### 列表展示

激活码列表增加 `reservedEmail` 列：
- 有值时显示邮箱
- 无值时显示 "—"（通用码）

## 错误码

| 错误码 | 场景 | 用户提示 |
|--------|------|----------|
| ACTIVATION_RESERVED_MISMATCH | 邮箱与预绑定不匹配 | 此激活码已分配给特定用户。 |

## 不做的事

- 不发送邮件通知用户有专属码（由管理员自行通知）
- 不支持创建后修改预绑定邮箱（如需变更，撤销旧码换新码）
- 不在客户端 UI 显示"此码为专属码"的标识
