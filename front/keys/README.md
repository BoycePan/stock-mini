# 小程序上传密钥

上传密钥用于 miniprogram-ci 自动上传，**已 gitignore，不要提交到仓库**。

## 获取密钥

1. 打开 [微信公众平台](https://mp.weixin.qq.com) → 「开发管理 → 开发设置 → 小程序代码上传」；
2. 点击「生成」，输入 IP 白名单（**必须是执行上传脚本的机器出口 IP**，如本机公网 IP / CI 运行环境出口 IP）；
3. 下载生成的 `private.key`。

## 存放位置（二选一，上传脚本会自动查找）

- 仓库根目录 `keys/private.<appid>.key`（本项目当前使用的就是这里，例如 `keys/private.wx2cfd1556edf21a24.key`）；
- 或 `front/keys/private.key`。

## 使用

```bash
# 密钥文件就位后直接上传
pnpm upload

# 自定义版本号 / 备注（pnpm 透传参数用 -- 分隔）
pnpm upload -- --version=1.2.0 --desc=发版

# 只校验配置与密钥，不真正上传
pnpm upload -- --dry-run

# 生成预览二维码
pnpm upload:preview

# 或通过环境变量传入（CI 推荐，不落盘）
WX_PRIVATE_KEY="$(cat private.key)" pnpm upload
```

> 提示：
> - IP 白名单修改后需重新生成密钥，旧密钥立即失效；
> - 上传版本号需唯一（格式如 `1.0.1`），重复版本会被微信拒绝，可用 `--version=` 或 `WX_VERSION` 指定；
> - GitHub Actions 等 CI 中密钥通过 Secret 传入（`WX_PRIVATE_KEY`），并需保证运行环境出口 IP 在白名单内。
