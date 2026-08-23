# 概览

基础地址：

```text
https://synapse.d2.pub/api/open/v1
```

## 创建 API 密钥

在 Console 的“设置 > API 秘钥”中创建密钥，并勾选“获取分享链接文件”。完整密钥只显示一次。

API 密钥仅用于服务端、CLI 或自动化客户端。不要把密钥写入浏览器代码、公开仓库或分享链接。

## Bearer 认证

创建下载地址时通过 `Authorization` header 传入 API 密钥：

```http
Authorization: Bearer syn_sk_example000000000000000000000000000000000000
```

Cookie、用户登录 token、`X-API-Key` 和 query 参数均不能替代该 header。

## 安全要求

API 密钥和临时下载地址均属于 bearer credential，不得写入浏览器代码、公开仓库、日志、工单或公开消息。

## 可用 API

- [获取分享链接文件](/open-api/api/share-link-download)
