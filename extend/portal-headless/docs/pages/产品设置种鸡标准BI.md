# 产品设置种鸡标准(BI)

页面路径：`/dashboard/product/setting/standard-manage/standard-flock-week/list`。

## 页面能力定义

| 页面动作 | SDK 能力 / 方法 | Portal 请求 |
| --- | --- | --- |
| 查询列表 | `product-setting-standard-flock-week-list` / `productSettingStandardFlockWeek.list` | `GET /base/standardFlockWeek/page` |
| 准备新建 | `product-setting-standard-flock-week-prepare-create` / `productSettingStandardFlockWeek.prepareCreate` | 不发请求 |
| 新建 | `product-setting-standard-flock-week-create` / `productSettingStandardFlockWeek.create` | `POST /base/standardFlockWeek/save` |
| 准备编辑 | `product-setting-standard-flock-week-prepare-update` / `productSettingStandardFlockWeek.prepareUpdate` | 不发请求 |
| 编辑 | `product-setting-standard-flock-week-update` / `productSettingStandardFlockWeek.update` | `POST /base/standardFlockWeek/save` |
| 准备删除 | `product-setting-standard-flock-week-prepare-remove` / `productSettingStandardFlockWeek.prepareRemove` | 不发请求 |
| 删除 | `product-setting-standard-flock-week-remove` / `productSettingStandardFlockWeek.remove` | `DELETE /base/standardFlockWeek/{id}` |

页面属于 `门户 → 系统设置 → 生产设置 → 标准库管理`，不是独立顶层生产系统。请求使用 `product` HTTP 实例，固定追加 `devicetype=PC`，本页不发送 `module-type`。菜单和路由权限为 `/dashboard/frame/standard-library/standard-flock-week`。

Portal 页面声明了 `base:standard-flock-week:query` 和 `base:standard-flock-week:submit`；查询没有单独调用 query 权限，新增、编辑和删除由 `permissionCheck(permissions.submit)` 控制。SDK不绕过服务端当前会话的实际权限校验。

## 参数契约与表单提交规则

列表使用 `useListPageModule({ styleV2: true, customLoad, getDataListIsPage: true })`。默认请求参数为：

```json
{
  "order": "",
  "orderField": "",
  "year": "",
  "gen": "",
  "variety": "",
  "line": "",
  "pageNo": 1,
  "pageSize": 20
}
```

页面的 `convertFetchForm` 会在 `startWeekAge` 或 `endWeekAge` 为空、空字符串或0时删除对应参数；SDK保持这一规则，不在默认查询中发送这两个字段。提供时范围为 `1` 至 `200`。分页支持 `10/20/50/100`。

新建和编辑弹窗的 `year`、`weekAge`、`variety`、`line`、`gen`、`housed`、`hatchingEggLayingRate` 七项均有 `required` 规则；数值控件范围均为 `-10000000` 至 `10000000`。产蛋率按页面百分数填写，提交时严格除以 `100`：

```json
{
  "year": 2026,
  "weekAge": 12,
  "variety": "V1",
  "line": "L1",
  "gen": "G1",
  "housed": 120,
  "hatchingEggLayingRate": 0.82
}
```

Java `StandardFlockWeekController` 的分页响应会把数据库中的 `hatchingEggLayingRate` 比例小数乘以 `100`；例如数据库值 `0.82` 返回 `82`。Portal 编辑弹窗直接使用列表响应值回显，不再次乘100，提交时再除以100。SDK的 `prepareUpdate()` 接收弹窗表单值，保留 `...props.raw` 中的扩展字段，再覆盖编辑字段和ID。

## 逐字段基准

| 字段 | 含义 |
| --- | --- |
| `id` | 种鸡标准(BI)记录ID；编辑和删除目标。 |
| `year` | 年度。 |
| `weekAge` | 周龄。 |
| `variety` | 品种字典值；保存和筛选使用。 |
| `line` | 品系字典值；保存和筛选使用。 |
| `gen` | 代次字典值；保存和筛选使用。 |
| `housed` | 入舍只鸡单产标准；服务端原始数值。 |
| `hatchingEggLayingRate` | 合格种蛋产蛋率标准；列表响应是服务端乘100后的百分数值，保存草稿是页面输入除100后的比例小数。 |
| `total` | 当前筛选条件下的记录总数。 |

SDK保留后端返回的页面无关扩展字段，但不把它们当作页面业务字段；网络、权限、Java业务错误或响应结构错误会抛出，不降级为空列表。

## 逐页操作步骤、权限与证据边界

1. 用 `list()` 读取最新列表，确认目标行的 `id`、年度、周龄、品种、品系、代次和指标值。
2. 新建先调用 `prepareCreate()`；编辑先按Portal弹窗当前值准备 `prepareUpdate()`，确认 `draft` 保留当前行ID和raw字段。
3. 用户明确确认后，把同一 `draft` 原样交给 `create()` 或 `update()`；成功或响应不确定后重新调用 `list()` 回查。
4. 删除先调用 `prepareRemove({ id })`，用户确认后调用 `remove({ id })`；成功或响应不确定后重新查询，确认目标ID不再出现。

本轮逐页核对了Portal菜单、路由、列表、弹窗、product HTTP、权限实现、Java `StandardFlockWeekController`/`StandardFlockWeek`/`StandardFlockWeekVO`/`StandardFlockWeekServiceImpl`/Mapper、SDK请求和离线反证测试。尚未在真实测试环境使用浏览器会话执行列表、`prepare → submit → 回查`及删除闭环；当前证据为Portal/Java源码和离线请求形状测试。
