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

## 本地验证

EXT：

```text
npm run typecheck       PASS
npm test                PASS — 11 files, 30 tests
npm run build           PASS — background/content/popup/manifest
npm run check:package   PASS — 6 files, 3 manifest references
```

Auth：

```text
npm run typecheck       PASS
npm run typecheck:do    PASS
npm test                PASS — 54 files, 478 tests
npm run test:do         PASS — 12 files, 122 tests (exit 0)
npm run build:frontend  PASS — 206 modules
```

`npm run test:do` 会打印 `CquLoginContainer` 在本地 workerd 未启用的 uncaught exception。单独运行既有 `test/do/cqu-session.do.test.ts` 可复现，同样 62/62 通过且退出 0；它是当前容器测试夹具的已知噪音，不作为真实容器或生产通过证据。

## 发布包

- 文件：`releases/cqu-quicklogin-0.1.0-canary.zip`
- 内容：仅 `dist/` 的 7 个 zip 条目（6 个文件和 `assets/` 目录）
- SHA-256：`049ba823053759ce39341f0bd3c37c998ab7183f96ffdcb668f33290026f1cb3`
- 上传：未执行

## 设计条款覆盖

| 设计条款 | 实现任务 | 自动化/实测状态 |
| --- | --- | --- |
| 独立 SSO、主会话保护、共享 OTP 租约 | 05–07 | DO/unit PASS；A16 NOT RUN |
| grant 隔离与即时撤销 | 02、03、08、09 | provider/DO PASS；A11/A12/A17 NOT RUN |
| 额度、层级开关和降低预览 | 01、02、04、15、16 | unit/DO/UI build PASS；A10/A13/A14 NOT RUN |
| 心跳、可信 IP 和离线策略 | 07、08、11、15 | fake-clock/unit PASS；A18 长期观察 NOT RUN |
| Cookie 完整性、归属与中断恢复 | 01、11、12 | 合成故障测试 PASS；A04/A08/A09/A15 NOT RUN |
| 学校状态、有限重试与手动模式 | 11、13、14 | unit/UI build PASS；A02/A03/A05/A06/A07 NOT RUN |
| 指定 UI skills 与退出提示 | 13、14、15 | 代码复查 PASS；真实截图/键盘浏览器验收 NOT RUN |
| 升级、协议和明确迁移 | 10、16–18 | package/fixture PASS；生产迁移 NOT RUN |

## Canary 部署状态

- 生产 D1 迁移 `0009_quicklogin_devices.sql`：已应用。
- 唯一旧 QuickLogin 用户：preview-hash 初始化为 master=true、额度 5，读回 used=0。
- canary OAuth client：`cqu-quicklogin-chrome`，扩展 ID `igfidegfgfoofnoncpmbcokbffjmmook`，固定回调/Origin/PKCE 配置已读回。
- Auth Worker：版本 `db84afcb-aea1-40ed-9ab1-c85f809f613c`，`QUICKLOGIN_DEVICE_MODE=on`。
- WAF/JWKS 修复：Auth `60e7c8f`；保存 grant 重试注册：EXT `b5ca451`。
- 真实 Chrome 已验证 token 兑换 200、修复前设备注册 401；修复部署并重新加载后复用同一保存 grant 注册成功，未再次弹授权页。
- Auth 权威列表读回 `used=1 / deviceLimit=5`，目标设备在线、子开关已启用。
- 生产设置页和 session-only API：真实浏览器读回 200，显示“已启用 0 / 5 台”。

## 仍未通过的发布门禁

- 真实普通 Chrome 加载、学校业务页面登录、跨 tab、外来会话和重启升级：`NOT RUN`。
- 1 小时保活、7 小时重登、离线 7 天的真实时长观察：`NOT RUN`。
- Chrome Web Store 上传/发布：未执行。

Canary 后端已发布，但商店和真实学校页面验收仍未完成。后续不能因为 API/设置页读回成功而跳过实际 Chrome、Cookie 所有权和学校业务页面验收。
