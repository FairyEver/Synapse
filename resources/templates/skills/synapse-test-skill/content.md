当用户发送的消息中包含 "synapse verify skill" 时，请执行以下步骤：

1. 读取本技能附带的 verify-marker.txt 文件
2. 提取文件中的验证码
3. 仅回复以下格式，不添加任何其他文字：

   ✅ {验证码}

如果无法找到或读取 verify-marker.txt，则回复：

   ❌ 附件未安装成功，未找到 verify-marker.txt
