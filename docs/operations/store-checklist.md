# Chrome Web Store 检查清单

本清单用于发布前人工复核，不表示商店已经批准。没有单独授权时不得上传。

商店文案、逐项权限理由、数据申报草稿、素材规格和提交步骤统一维护在 [CHROMEWEBSTORE.md](../../CHROMEWEBSTORE.md)。2026-10-10 已完成源码与官方要求对照；当前仍缺图标、宣传图、当前截图、完整隐私细节与审核测试路径，未上传商店。

## 权限用途

- `cookies`：仅同步和核对 `sso.cqu.edu.cn` / `.sso.cqu.edu.cn` 的 SSO Cookie；不读取学校业务域 Cookie。
- `identity`：发起 Auth 的 OAuth authorization-code + PKCE 流程，固定使用 Chromium 扩展回调。
- `storage`：在 trusted contexts 保存设备 ID、OAuth token、generation、Cookie 摘要和中断恢复日志；内容脚本不能读取 token。
- `alarms`：正常可用时每 5 分钟检查；`preparing` / `refreshing` 时每 30 秒检查，并为受限重试保留 Worker 重启后的唤醒点。

Host permissions 当前精确限定为 `https://auth.cqu.moe/*`、`https://sso.cqu.edu.cn/*` 和 `https://p.cqu.moe/*`；后者用于启用诊断配置时发送操作结果及异常，须在商店隐私申报中说明。不得加入 `<all_urls>`、学校业务域、远程脚本或远程可执行更新器。

## 数据与退出

Auth 处理学校绑定凭据及云端学校会话，并保存必要的设备名称、Chrome 版本和最近联系信息。扩展自身不读取或保存学校密码，不读取学校业务域 Cookie。扩展本地保存 OAuth token 和 Cookie 所有权摘要；旧 Cookie 明文快照只存在 `storage.session`，用于中断回滚。诊断经 `p.cqu.moe` 发送脱敏后的操作结果、错误及随机安装标识；实际日志保存期限、服务商与删除方式在送审前核对并补入隐私政策。

用户可在插件关闭当前设备，或在 Auth 设置页退出指定设备。退出会停止新同步并只清理摘要仍匹配的本插件 Cookie；学校系统中已经建立的登录可能继续有效，界面必须明确说明这一点。

## 打包复核

- [ ] `npm run typecheck && npm test && npm run build && npm run check:package` 全部通过。
- [ ] zip 只含 `dist/` 文件；无 `.env`、实验目录、源码 map、私钥、`client_secret` 或 token 导出。
- [ ] manifest 权限、host permissions、content script 和 popup 引用与构建产物一致。
- [ ] 正式 `clientId`、扩展 ID、固定回调和精确 Origin 已通过 Better Auth 管理模型读回。
- [ ] 普通 profile 验收 A01–A17 已记录；A18 长期观察不能用 fake clock 代替。
- [ ] 隐私政策 URL 可公开访问，申报与最终包一致；文案、截图和审核结论均来自真实资料。商店图片包括入包的 128×128 PNG 图标、至少一张合格截图和 440×280 小宣传图。
- [ ] 审核员可通过专用账号和说明完成核心功能验证；商店 ID 与 Auth 授权配置匹配。
- [ ] 已获得单独的上传与发布批准。
