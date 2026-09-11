# QuickLogin 实施交接

交接时间：2026-09-11（Asia/Shanghai）

## 仓库与提交

Auth 工作树：`/Users/uu/Developer/cqu-moe/auth/.worktrees/quicklogin-implementation`

分支：`codex/quicklogin-implementation`

| 任务 | Auth 提交 |
| --- | --- |
| 01 | `1afcaff`；测试夹具修正 `22c6508` |
| 02 | `46bea1f` |
| 03 | `4e3f6e3` |
| 04 | `032f04b` |
| 05 | `ceae178` |
| 06 | `e17b08a` |
| 07 | `bfde2ca` |
| 08 | `d0638bd` |
| 09 | `cd65938` |
| 15 | `f56164d` |
| 16 | `9a9f555`；canary 配置 `0f0064e`、受控设置 `a2d6473`、mode on `4e25cd8` |
| 17 | `442125e` |
| 生产修复 | OAuth 本地 JWKS 验签 `60e7c8f`；空值 Cookie 占位过滤 `11a2f2b` |

扩展仓库：`/Users/uu/Developer/cqu-moe/quicklogin`

分支：`codex/quicklogin-implementation`

| 任务 | EXT 提交 |
| --- | --- |
| 10 | `5aa9ea7` |
| 11 | `1470f99` |
| 12 | `d77f808` |
| 13 | `939c8b5` |
| 14 | `613cb98` |
| 16 | `1db9532` |
| 17 | `c11378a` |
| 18 | `420cb61`；canary 固定 ID `24403fd`；部署后记录见本文后续提交 |
| 生产修复 | 保存 grant 重试 `b5ca451`；host-only 查询 `4dae89a`；Cookie 精确读回 `855ab9e` |

## 本地验证

EXT：

```text
npm run typecheck       PASS
npm test                PASS — 12 files, 37 tests
npm run build           PASS — background/content/popup/manifest
npm run check:package   PASS — 6 files, 3 manifest references
```

Auth：

```text
npm run typecheck       PASS
npm run typecheck:do    PASS
npm test                PASS — 55 files, 481 tests
npm run test:do         PASS — 12 files, 122 tests (exit 0)
npm run build:frontend  PASS — 206 modules
```

`npm run test:do` 会打印 `CquLoginContainer` 在本地 workerd 未启用的 uncaught exception。单独运行既有 `test/do/cqu-session.do.test.ts` 可复现，同样 62/62 通过且退出 0；它是当前容器测试夹具的已知噪音，不作为真实容器或生产通过证据。

## 发布包

- 文件：`releases/cqu-quicklogin-0.1.0-canary.zip`
- 内容：仅 `dist/` 的 7 个 zip 条目（6 个文件和 `assets/` 目录）
- SHA-256：`2e0178d1774d24de7216e4123b5b015f6abaaa87ebbf52c443be0beb5e41ffe2`
- 上传：未执行

## 设计条款覆盖

| 设计条款 | 实现任务 | 自动化/实测状态 |
| --- | --- | --- |
| 独立 SSO、主会话保护、共享 OTP 租约 | 05–07 | DO/unit PASS；A16 NOT RUN |
| grant 隔离与即时撤销 | 02、03、08、09 | provider/DO PASS；A11/A12/A17 NOT RUN |
| 额度、层级开关和降低预览 | 01、02、04、15、16 | unit/DO/UI build PASS；A10/A13/A14 NOT RUN |
| 心跳、可信 IP 和离线策略 | 07、08、11、15 | fake-clock/unit PASS；A18 长期观察 NOT RUN |
| Cookie 完整性、归属与中断恢复 | 01、11、12 | 合成故障测试与 Ego Lite 实际写入 PASS；A04/A08/A09/A15 NOT RUN |
| 学校状态、有限重试与手动模式 | 11、13、14 | unit/UI build 与 A02 Ego Lite PASS；A03/A05/A06/A07 NOT RUN |
| 指定 UI skills 与退出提示 | 13、14、15 | 代码复查与 Ego Lite popup 实测 PASS；完整键盘验收 NOT RUN |
| 升级、协议和明确迁移 | 10、16–18 | package/fixture 与生产迁移 PASS；商店发布 NOT RUN |

## Canary 部署状态

- 生产 D1 迁移 `0009_quicklogin_devices.sql`：已应用。
- 唯一旧 QuickLogin 用户：preview-hash 初始化为 master=true、额度 5，读回 used=0。
- canary OAuth client：`cqu-quicklogin-chrome`，扩展 ID `igfidegfgfoofnoncpmbcokbffjmmook`，固定回调/Origin/PKCE 配置已读回。
- Auth Worker：版本 `c9cac439-bdff-4cc7-8bc0-f9721ffebc15`，`QUICKLOGIN_DEVICE_MODE=on`。
- WAF/JWKS 修复：Auth `60e7c8f`；空值 Cookie 占位过滤：Auth `11a2f2b`；保存 grant 重试注册：EXT `b5ca451`；Cookie 精确读回：EXT `855ab9e`。
- 真实 Chrome 已验证 token 兑换 200、修复前设备注册 401；修复部署并重新加载后复用同一保存 grant 注册成功，未再次弹授权页。
- Auth 权威列表读回 `used=2 / deviceLimit=5`，Google Chrome 与 Ego Lite Chromium 152 两个设备在线、子开关均已启用。
- Ego Lite 独立 TaskSpace 完成真实 OAuth、设备注册、云端 ready 与本地 Cookie 写入；弹窗显示“快捷登录已准备”。
- 同一 Ego Lite 会话访问学校 CAS 后到达 `https://my.cqu.edu.cn/workspace/cas`，页面标题“智慧教务 - 重庆大学”，未出现学校登录表单。

## 仍未通过的发布门禁

- Google Chrome 最终扩展构建复测、跨 tab、外来会话和重启升级：`NOT RUN`；Ego Lite Chromium 152 的加载、授权、Cookie 同步与学校业务落地已通过。
- 1 小时保活、7 小时重登、离线 7 天的真实时长观察：`NOT RUN`。
- Chrome Web Store 上传/发布：未执行。

Canary 后端与 Ego Lite Chromium 实际路径已通过；Google Chrome 最终构建复测、长期观察和商店发布仍未完成。
