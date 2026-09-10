# Chrome Web Store 检查清单

本清单用于发布前人工复核，不表示商店已经批准。没有单独授权时不得上传。

## 权限用途

- `cookies`：仅同步和核对 `sso.cqu.edu.cn` / `.sso.cqu.edu.cn` 的 SSO Cookie；不读取学校业务域 Cookie。
- `identity`：发起 Auth 的 OAuth authorization-code + PKCE 流程，固定使用 Chromium 扩展回调。
- `storage`：在 trusted contexts 保存设备 ID、OAuth token、generation、Cookie 摘要和中断恢复日志；内容脚本不能读取 token。
- `alarms`：每 5 分钟触发状态/版本检查，并为受限重试保留 Worker 重启后的唤醒点。

Host permissions 只能是 `https://auth.cqu.moe/*` 和 `https://sso.cqu.edu.cn/*`。不得加入 `<all_urls>`、学校业务域、远程脚本或远程可执行更新器。

## 数据与退出

Auth 保存设备名称、Chrome 版本、最近联系时间和运行环境提供的最近 IP；不保存学校密码、验证码、浏览器 localStorage、业务 Cookie 或完整 ticket URL。扩展本地保存 OAuth token 和 Cookie 所有权摘要；旧 Cookie 明文快照只存在 `storage.session`，用于中断回滚。

用户可在插件关闭当前设备，或在 Auth 设置页退出指定设备。退出会停止新同步并只清理摘要仍匹配的本插件 Cookie；学校系统中已经建立的登录可能继续有效，界面必须明确说明这一点。

## 打包复核

- [ ] `npm run typecheck && npm test && npm run build && npm run check:package` 全部通过。
- [ ] zip 只含 `dist/` 文件；无 `.env`、实验目录、源码 map、私钥、`client_secret` 或 token 导出。
- [ ] manifest 权限、host permissions、content script 和 popup 引用与构建产物一致。
- [ ] 正式 `clientId`、扩展 ID、固定回调和精确 Origin 已通过 Better Auth 管理模型读回。
- [ ] 普通 profile 验收 A01–A17 已记录；A18 长期观察不能用 fake clock 代替。
- [ ] 隐私政策 URL、商店文案、截图和审核结论均来自真实资料；本仓库当前没有杜撰这些内容。
- [ ] 已获得单独的上传与发布批准。
