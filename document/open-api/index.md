# 概览

Synapse 开放接口使用版本化路径。当前版本的基础地址为：

```text
https://synapse.d2.pub/api/open/v1
```

## 快速开始

1. 在 Console 的“设置 > API 秘钥”中创建 API 密钥，选择“获取分享链接文件”。
2. 使用 API 密钥调用创建下载地址接口。
3. 在十分钟内对响应中的临时地址发起 `GET` 请求。

完整示例：[获取分享链接文件](/open-api/api/share-link-download)

## 创建 API 密钥

在 Console 的“设置 > API 秘钥”中创建密钥，并选择“获取分享链接文件”。该权限对应的 scope 是：

```text
drive.share_link.download
```

完整密钥只显示一次。创建后可以编辑或清空 API 权限，不会轮换密钥；撤销密钥后无法恢复。移除下载权限或撤销密钥会使新请求以及尚未开始的临时下载失效。

## Bearer 认证

创建下载地址时通过 `Authorization` header 传入 API 密钥。认证格式固定为单个 `Bearer` scheme 和一个不含空白的密钥：

```http
Authorization: Bearer syn_sk_example000000000000000000000000000000000000
```

Cookie、用户登录 token、`X-API-Key` 和 query 参数均不能替代该 header。

## 集成要求

- API 密钥仅用于服务端、CLI 或自动化客户端。开放接口不提供浏览器跨域调用所需的 CORS。
- API 密钥和临时下载地址均属于 bearer credential，不得写入浏览器代码、公开仓库、日志、工单或公开消息。
- JSON 响应中的 `requestId` 与 `X-Request-Id` 响应头一致，可用于 Console 使用记录和问题排查。
- 当前接口不设置 API 密钥、IP、次数、并发数或请求频率限制。

## 可用 API

| 方法 | 路径 | 权限 | 文档 |
|---|---|---|---|
| `POST` | `/drive/share-links/downloads` | `drive.share_link.download` | [获取分享链接文件](/open-api/api/share-link-download) |
