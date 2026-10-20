# QuickLogin PostHog 审计修复复核

复核日期：2026-10-20（Asia/Shanghai）

目标项目：`662666`

原审计：[PostHog notebook](https://us.posthog.com/project/662666/notebooks/dHB8mFAz)

修复基线：`d273910f9d935b65112d6db2adcce403783b5956`，分支 `codex/quicklogin-posthog-audit`。

## 结论

已通过 PR #29 合并并发布 `0.4.9`，修复代理检测标记被脱敏器删除的问题，并将 `posthog-js` 从 `1.433.5` 升至 `1.438.12`。原报告的两项 error 未被证据支持：CI 已注入配置，退出和换账号也使用独立身份。官网真实事件已入库并携带正确代理标记；健康告警仍等待下一轮每日检查。

| 原检查 | 复核结果 | 证据与处置 |
| --- | --- | --- |
| 缺少本地 env，导致不上报 | 原结论不成立 | `.github/actions/verify/action.yml` 向两套构建注入 token；Checks 和 release workflow 均读取 `vars.POSTHOG_PROJECT_TOKEN`。项目最近 7 天实际收到 5,122 条扩展操作事件；官网也有 `0.4.8+d273910…` 的网页事件。本地无 token 时继续静默停用，不把公共 token 写入仓库。 |
| 退出或换账号没有 reset，导致身份串用 | 原结论不成立 | `src/shared/posthog.ts` 按 distinct ID 创建内存客户端。真实 SDK 请求测试经过 `clearDeviceAuthorization()`，身份依次为账号 A、安装 ID、账号 B，actor type 依次为 user、installation、user；没有产生身份合并事件。 |
| SDK 版本过期 | 已修复，本地验证通过 | npm 注册表确认 `1.438.12`；`package.json` 和 `package-lock.json` 已同步更新，仅升级现有 PostHog 依赖及其关联包。 |
| 缺少 signup 事件 | 不适用于当前边界 | `registerSavedAuthorization()` 注册设备，并可复用已有授权；它不证明创建了新账号。`loginInteractive()` 已上报 `quicklogin_operation_completed`，operation=connect，并区分 success/failure。账号创建归独立 Auth 服务；未添加会把重连误计为注册的事件。 |
| 未检测到反向代理 | 已发布并读回官网真实事件 | 现在仅保留精确、已批准的 `$lib_custom_api_host=https://p.cqu.moe`。官网真实 `$pageview` 已入库；扩展事件通过真实 SDK 的本地请求测试，未重载用户已安装扩展。 |
| 无法读取错误追踪建议 | 权限盲点已解除 | 本次 CLI 能读取四项项目建议。source_maps 与 long_running_issues 均为 completed；alerts 和 rate_limits 未完成，属于共享项目的配置建议。未自动添加告警接收者或设置会丢弃事件的项目配额。 |

## 根因和复现

PostHog 的反向代理健康检查每天检查最近的 `$pageview` / `$screen` 是否包含 `$lib_custom_api_host`。本项目的 `api_host` 已使用代理，但 `before_send` 的属性白名单丢弃了该字段。仅检查请求目标域名无法发现这个缺口。

命令：

```sh
npm test -- src/shared/posthog-privacy.sdk.test.ts
```

修复前连续复现：SDK 原始事件的标记为 `https://p.cqu.moe`，脱敏后断言失败：`expected undefined to be 'https://p.cqu.moe'`。修复后真实 SDK 的官网/扩展请求都保留该固定标记，隐私拒绝用例继续通过。没有添加生产调试日志或新的生产测试接口。

参考：[PostHog 代理健康检查说明](https://posthog.com/docs/health-checks/no-reverse-proxy)。

## 线上证据及边界

- 扩展：最近 7 天查询得到 5,122 条 `quicklogin_operation_completed`，版本 `0.4.6`，release `1f9130b9438715c230294bff08b25665b88f32a2`；查询时最近一条为 `2026-10-20 11:33:57 +08:00`。该数量是排障聚合，包含所有结果，不作为用户数或成功率指标。
- 官网：最近 7 天有 9 条 QuickLogin `$pageview`；其中 2 条来自 `0.4.8+d273910f9d935b65112d6db2adcce403783b5956`，最近为 `2026-10-16 13:20:35 +08:00`。历史接收证据不等于本次修复已经上线。
- 项目健康问题 `01a13ede-c153-7488-91d1-52456f34684c` 当前仍为 active。应在实际发布、收到包含标记的官网事件并等待下一轮健康检查后验收；本次未手动关闭告警。
- source_maps 建议的样本仅 2 帧，均已解析，低于其 20 帧最小样本阈值；不能据此声称所有产品、所有堆栈均正常。
- CLI 是项目范围凭据；组织级项目列表接口拒绝读取，不影响已核对 URL 的 `662666` notebook 和该项目数据查询。

## 本地验证

以下检查全部通过：

- `npm test`：23 个测试文件、186 项测试；包含真实 SDK 出站隐私、代理标记、退出和换账号验证。
- `npm run typecheck`、`npm run typecheck:website`。
- `npm run build`、`npm run build:website`。
- `npm run check:package`：协议契约、manifest/CSP 和包内容检查。
- `npm run check:website`：6 个页面、导航和静态资源检查。
- `npm run test:release`：10 项发布脚本测试。
- `git diff --check`。

构建使用未配置 token 的本地环境，证明可选遥测不会破坏构建；真实 SDK 测试使用虚构公共 token 和拦截 transport，不向生产灌入测试事件。测试仍有上游 SDK source-map 警告，官网构建仍有单块超过 500 kB 的提示，均不影响通过。

## 本地修复时的验收边界

本次没有 Git 提交、push、CI 运行、网站部署、扩展加载或商店发布，也没有用本机真实账号执行学校登录。修复仅增加诊断元数据并升级 SDK，未创建扩展版本或 canary 包。正式发布后需分别确认官网事件、安装新扩展后的实际事件，以及项目健康检查读回。

## 发布跟进

2026-10-20 用户授权后，[PR #29](https://github.com/cqu-moe/quick-login/pull/29) 在全部 PR 检查与两轮 MV3 E2E 通过后合并；源码及标签 `v0.4.9` 为 `8a42236dad09566255d165142a3b361e9c0676fd`。主分支普通检查、canary 发布及官网生产构建均成功。

正式包 `cqu-quicklogin-0.4.9-canary.zip` 为 151421 bytes，SHA-256 `c38a7d458a86635c65ffab8aa1283a145d0b42d2810fd22424eccd410f62a669`。真实浏览器认证下载返回 200、匿名下载返回 401；实际字节与主分支 CI 包一致，CRC、manifest 和 build-info 全部通过。

官网生产版本 `54be953c-85ca-4692-a8e8-2cd5aac34e58` 已部署到 100% 流量。PostHog 在 `2026-10-20 12:15:09.138 +08:00` 收到官网 `$pageview`：release=`0.4.9+8a42236dad09566255d165142a3b361e9c0676fd`，SDK=`1.438.12`，`$lib_custom_api_host=https://p.cqu.moe`，`is_test=true`、`$geoip_disable=true`、`$process_person_profile=false`。

完整证据见 `docs/operations/quicklogin-release.md` 与 `docs/operations/quicklogin-handoff.md`。健康告警待每日重新计算，未手动关闭；已安装扩展重载、真实学校 SSO 和 Chrome Web Store 均未操作。
