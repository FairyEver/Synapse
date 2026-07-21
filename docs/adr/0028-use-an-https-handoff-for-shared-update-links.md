# Use an HTTPS handoff for shared update links

Synapse 的对外更新入口长期稳定为不携带目标版本的 `https://synapse.d2.pub/desktop/update`，每次 GitHub Release 都把它作为“一键更新”入口写入发版说明，再由独立公开的更新承接页通过 `synapse://update` 把“更新到当前最新版”的意图交给客户端；该页面不进入 Dashboard 布局、不要求登录，也不直接对外分享自定义协议地址。页面加载时不主动唤醒客户端，而是先要求用户自行确认没有正在进行的任务，点击更新后才触发深链；客户端不额外检查 Agent、Workflow、Automation 等运行任务。`/desktop/` 命名空间避免与网站或内容更新入口混淆，HTTPS 链接也更容易被浏览器和聊天工具识别。承接页不提供安装包下载；客户端未被唤醒、协议被拦截，或旧客户端仅被唤醒但未打开更新页面时，只提示用户前往 Synapse 设置手动更新。代价是需要长期维护稳定的公开页面和深链交接契约。
