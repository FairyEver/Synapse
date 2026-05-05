#!/usr/bin/env node
// 用法: node decrypt-keys.js <keys.json.enc> [BACKUP_ENCRYPT_KEY]
// BACKUP_ENCRYPT_KEY 可通过参数传入或从环境变量读取

const fs = require('fs');
const crypto = require('crypto');

const encFile = process.argv[2];
const encryptKey = process.argv[3] || process.env.BACKUP_ENCRYPT_KEY;

if (!encFile || !encryptKey) {
  console.error('用法: node decrypt-keys.js <keys.json.enc> [BACKUP_ENCRYPT_KEY]');
  console.error('  BACKUP_ENCRYPT_KEY 也可通过环境变量传入');
  process.exit(1);
}

if (!fs.existsSync(encFile)) {
  console.error(`错误: 文件不存在 - ${encFile}`);
  process.exit(1);
}

if (!/^[0-9a-fA-F]{64}$/.test(encryptKey)) {
  console.error('错误: BACKUP_ENCRYPT_KEY 格式无效，应为 64 位十六进制字符串');
  process.exit(1);
}

try {
  const data = fs.readFileSync(encFile);

  if (data.length < 29) {
    console.error('错误: 加密文件格式无效（文件过小）');
    process.exit(1);
  }

  // 格式: iv(12 bytes) + authTag(16 bytes) + ciphertext
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const ciphertext = data.subarray(28);

  const key = Buffer.from(encryptKey, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, null, 'utf8');
  decrypted += decipher.final('utf8');

  const keys = JSON.parse(decrypted);
  console.log('解密成功！\n');
  console.log('LICENSE_PRIVATE_KEY:');
  console.log(keys.privateKey);
  console.log('\nLICENSE_PUBLIC_KEY:');
  console.log(keys.publicKey);
  console.log('\nLICENSE_KEY_ID:');
  console.log(keys.keyId);
} catch (err) {
  if (err.message.includes('Unsupported state') || err.message.includes('unable to authenticate')) {
    console.error('错误: 解密失败 - 密钥不正确或文件已损坏');
  } else if (err instanceof SyntaxError) {
    console.error('错误: 解密后的内容不是有效的 JSON');
  } else {
    console.error(`错误: ${err.message}`);
  }
  process.exit(1);
}
