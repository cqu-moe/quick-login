# QUICKLOGIN-01：真实 MV3 OAuth / 设备登记与事故修复证据

状态：QUICKLOGIN-01 本地实现与验收完成。固定签名实现提交后的两轮全新环境均 6/6，通过全部失败门禁并完成清理。未 push、未开 PR、未自行 merge；独立 review、merger 和远端 CI 由父代理安排。此报告位于本票 worktree 根目录，供父代理收集到工作区总报告。

## 固定提交后的最终验收

- 实现提交：`81e0e6912235e470e8dc4ba4a43918afab352acd`；`git verify-commit HEAD` 退出 0，ED25519 签名有效，Git 签名状态为 G。
- Auth 依赖：`d9bf0c5e6d5cc459029da6a345991b8d0f13f514`，两轮启动均核实 HEAD 和 tracked 清洁状态；没有修改依赖 checkout。
- 扩展构建：0.4.7；两轮均从实现提交重建，sourceDirty=false；`background.js` SHA-256 为 `f09114aaf620e0ae8a4d71b2d7d1d5e996d6a975f57897d9acc5c4955bf6a95d`。
- 两轮 run ID 分别为 `01a13fca-65a2-7735-bbdc-9fd346c92e4d`、`01a13fcb-172a-7ae2-b956-5b1d158a0293`；均 discovered / selected / executed / passed = 6，failed / interrupted / flaky / skipped = 0，cleanup=passed，unexpectedDeniedEgress=[]。每轮观测到 5 次真实授权请求、2 次被真实 Auth 接受的 token 兑换。
- 每轮独立 TLS、端口、D1 / DO 实例和 Chromium profile，启动与资源都写入本票隔离目录。最终 2026-10-15 13:46:28 UTC 的定向 ps 读回没有本票 profile 对应的存活 Chromium。
- integration 同步核对：`codex/e2e-coverage-20261015` 仍为基线 `549bcb08d47ab3b9a0d1431b84c7a0ea41ba1110`，integration-only 提交数为 0，无需合入新增 integration 内容；没有修改 integration worktree。报告 / 证据追加提交只更改 docs，与已验收实现的脚本及测试内容一致。

| 实际命令 | 退出码 / 结果 |
| --- | --- |
| `VITE_POSTHOG_PROJECT_TOKEN='' VITE_POSTHOG_HOST='' npm run build` | 0，固定提交重建 |
| `CI=true QUICKLOGIN_E2E_OUTPUT=.e2e/sol-final-run-1 node e2e/run.mjs` | 0，6/6，cleanup passed |
| `CI=true QUICKLOGIN_E2E_OUTPUT=.e2e/sol-final-run-2 node e2e/run.mjs` | 0，6/6，cleanup passed |
| `CI=true npm run test:e2e:self-check` | 控制脚本 0；指定断言 ASSERTION_FAILED，runner 1；清理通过 |
| `CI=true npm run test:e2e:zero` | 控制脚本 0；NO_TESTS，runner 2；清理通过 |
| `CI=true npm run test:e2e:lifecycle` | 控制脚本 0；缺依赖、单独清理失败、主失败与清理失败均 wrapper 1 |
| `npm run typecheck` / `npm run typecheck:e2e` | 各 0 |
| `npm test` | 0，23 文件、171/171 |
| `npm run test:release` | 0，10/10 |
| `npm run check:package` | 0，contract digest 正确、14 文件、3 manifest 引用 |
| `npm ci --dry-run --offline --ignore-scripts --cache .e2e/npm-cache` | 0，锁文件可解析；本地未重做完整安装 |
| PyYAML 解析 `.github/workflows/e2e.yml` | 0，18 steps，失败后仍准备产物 |
| `QUICKLOGIN_E2E_PUBLISH_DIR=.e2e/published-sol-final node e2e/prepare-ci-artifacts.mjs sol-final-run-1 sol-final-run-2` | 0，37 份产物及 sanitization.json，无问题 |
| `QUICKLOGIN_E2E_PUBLISH_DIR=.e2e/published-sol-failure node e2e/prepare-ci-artifacts.mjs sol-final-run-1 artifact-input-negative` | 预期 1，仍保留失败截图 / 报告；输入为真实负向控制输出的副本，原始证据未改动 |
| `git diff --cached --check` | 0 |

失败门禁的固定提交证据在 `.e2e/negative-1792071706926`、`.e2e/zero-1792071746492`、`.e2e/lifecycle-1792071807243`。cleanup-only 的 runner 为 0 但 wrapper 为 1；combined 的 runner / wrapper 均 1，原始 ASSERTION_FAILED 与 cleanupFailures 同时保留。探针自己放入的合成残留文件随后已移除，恢复结果有独立标记。

发布产物校验实际检查了 78 个文件（成功发布 38 个、失败发布 40 个），JSON 均可解析，无 DB / TLS / profile / 私钥文件，无合成邮箱完整地址或未脱敏 Bearer 值；成功与负向截图已目视核对，仅有合成扩展状态，不含用户数据。自动化不读取开发者云凭据，不使用模型或付费 AI。

提交保留的精简证据：

- `evidence/QUICKLOGIN-01/final-validation.json`：两轮结果、固定提交、原始报告 hash、失败控制、清理和验收边界；SHA-256 `c946144b41b3ecff402fec04ad63918c166066534a959acf6aeb5ce1ea04f9dd`。
- `evidence/QUICKLOGIN-01/publication-manifest.json`：成功发布目录所有 38 个文件的字节数和 SHA-256。
- `evidence/QUICKLOGIN-01/success-popup.png`、`negative-control.png`：真实无头扩展截图。
- `evidence/QUICKLOGIN-01/launcher-smoke-report.json`、`launcher-smoke-post-close.json`：事故后的唯一一次 smoke，原始证据与 hash 仍保留在 `.e2e/launcher-smoke-1792069690453/`。

未验证边界：远端 GitHub-hosted Ubuntu CI、固定 Auth SHA 的远端获取、原生权限弹窗、手机真机、真实学校账号 / Cookie / 容器访问、设备撤销和商店 / Worker 发布。本机 CI=true 不表示远端 CI 已通过。QUICKLOGIN-02/03 继续由后续票处理，未替代父代理的独立 review 或 merger。

## 恢复后的实现与预提交验证

真实构建扩展通过固定 Auth `d9bf0c5e6d5cc459029da6a345991b8d0f13f514` 执行真实 PKCE、登录、设备注册和 D1 / DO 读回。六个用例保护平台加载、成功连接、取消、错 state、错回调及注册失败；Auth 网页外部消息拒绝随成功旅程一同执行。没有产品源码改动，没有 manifest 清单测试。运行方式及 test-audit 归属见 `e2e/README.md`。

修复了测试观测器的独立问题：登录响应通过 JSON 返回 OAuth 跳转，原来的 Location-only 读取遗漏它；进一步实跑确认 JSON 响应被 gzip 压缩。TLS 代理请求 identity 编码并只记录 codeIssued 等布尔元数据。RED 为 `.e2e/sol-network-suite` / `.e2e/sol-state-observation`；修复后 `.e2e/sol-state-fixed` 1/1、`.e2e/sol-precommit-full` CI 模式 6/6，全部 cleanup passed。没有删除或放宽 state 拒绝断言。

已实际执行且退出 0：`npm run typecheck`、`npm run typecheck:e2e`、`npm test`（171/171）、`npm run test:release`（10/10）、遥测为空的 `npm run build`、`npm run check:package`。日志在 `.e2e/verification-sol/`。`CI=true npm run test:e2e:lifecycle` 验证缺失 Auth、成功测试但清理失败、主失败与清理失败同时保留，三个子探针均命中预期非零；控制文件在 `.e2e/lifecycle-1792071228555/control.json`。

YAML 已通过本机 PyYAML 解析；CI 提供两个全新环境、指定断言失败、零用例拒绝、三个生命周期控制及 always 产物准备 / 上传。远端 GitHub Actions 尚未执行，不能将本机 CI 模式等同远端通过。

签名前有效身份为 `User-Unauthorized <69748465+UserUnauthorized@users.noreply.github.com>`，配置来自全局且 repository-local 未覆盖，`commit.gpgsign=true`；按原配置签名，不更改身份。integration 当前为 `549bcb08d47ab3b9a0d1431b84c7a0ea41ba1110`，与本票原始基线一致。

## 事故后的单次 smoke（恢复业务套件前）

该次仅启动一次当前自定义 launcher，使用独立临时 profile、真实 `dist/` 扩展和以下显式参数：

```text
--headless=new
--password-store=basic
--use-mock-keychain
```

没有 headed 重试或其他浏览器 fallback，没有启动 Auth 服务、运行 Auth 套件、操作系统钥匙串或触碰用户默认浏览器 profile。所有浏览器网络请求经本地拒绝代理；本次拦截 5 次请求，没有保存请求内容或凭据。没有截图。

实际命令（当前目录为本票 worktree）：

```sh
node --experimental-strip-types e2e/launcher-smoke.mjs
```

退出码 **0**；`launchAttempts=1`；耗时 **1407 ms**；验证预算 17 秒、硬截止 29 秒，低于用户要求的 30 秒上限。

## 实际读回

- 操作系统 `/bin/ps -ww -p 69591 -o command=` 的实际命令行包含全部三个 flags、独占 `--user-data-dir` 和当前 `dist/` 的 `--load-extension`。
- Chromium 为 `156.0.8078.4`；popup 与真实 MV3 service worker 均读回 `chrome.runtime.id = igfidegfgfoofnoncpmbcokbffjmmook`。
- service worker URL 为 `chrome-extension://igfidegfgfoofnoncpmbcokbffjmmook/background.js`。
- 实际加载构建为 0.4.7，构建 provenance 的源提交为 `549bcb08d47ab3b9a0d1431b84c7a0ea41ba1110`。launcher 本身仍为未提交实现。
- 主 PID 为 `69591`；本批 PID 为 `69591, 69615, 69616, 69617, 69618, 69630, 69631, 69632, 69637, 69641, 69642, 69643`。launcher release 后全部消失，独立定向 `ps` 复核也无存活 PID。
- 临时 profile `.e2e/launcher-smoke-1792069690453/profiles/chromium-g8tFxz` 已删除。
- `primaryFailures=[]`，`cleanupFailures=[]`。没有重启或重试。

## 启动与清理审核

唯一自定义 Chromium spawn 位于 `e2e/browser.ts`；正常 runner、负向控制、零选择控制及 CI 都通过这个 provider。`helpers.ts` 只连接已有 CDP，不另起浏览器。

本次把 profile 创建后、lease 交付前的整个参数构造和启动过程放入 `try/catch/finally`：未交付的启动在 `finally` 中停止已创建的子进程并删除本批 profile；spawn 前抛错也删除 profile；启动和清理同时失败则保留两个原因。成功 lease 由调用方的 `finally` release；CDP 全局引用也在 release 的 `finally` 清除。保留 SIGTERM 后最多 5 秒转 SIGKILL、再最多 3 秒等待退出的上限。

smoke 当次静态检查均退出 0：`npm run typecheck:e2e`、`node --check e2e/launcher-smoke.mjs`、仅导入 `e2e/browser.ts` 且不调用 acquire 的模块检查。失败启动分支当时只做代码及类型审核，没有额外启动第二个浏览器来注入失败。该次动态证据证明正常启动及关闭路径；恢复业务授权后的生命周期失败门禁另见前面的最终验收。

## 之前启动方式的可核实范围

接手后的可见执行记录中没有 `open -a`，也没有无参数启动 Chromium 或 Chrome for Testing。此前确实通过 `spawn(chromium.executablePath(), arguments_)` 直接启动过浏览器；这些启动带有独占 `--user-data-dir` 和扩展参数。

最早两轮 `sol-baseline-allowed` 与 `sol-surface-probe` 尚未带 headless，且缺少 basic password store 与 mock keychain。之后加入 headless，直到用户报告钥匙串干扰后才补齐后两个参数。这些历史失败与运行证据原样保留。

19:01 前任的完整操作历史本次没有复核，不能代其确认是否使用过 `open -a` 或无参启动。父代理说明的默认 profile 进程 PID 8144 未纳入本次 batch，也未被本 smoke 操作。

## 证据与剩余边界

- 原始合成 smoke 证据：`.e2e/launcher-smoke-1792069690453/report.json`，包含实际进程命令行、扩展与 worker 读回、批次 PID 和清理结果。
- 独立关闭后复核：`.e2e/launcher-smoke-1792069690453/post-close.json`。
- smoke report SHA-256：`09de0312e0079d1dbcd7470b92aeef281c1d28dd0feeeaa9b44141c3c891290d`。
- 暂停前的 RED `.e2e/sol-network-suite` 原样保留：5/6，错 pending-state 的 codeIssued 观测失败，cleanup passed；恢复后的修复与验证单列，不以 smoke 代替业务套件。
- smoke 原始报告的脱敏副本已随票保存为 `evidence/QUICKLOGIN-01/launcher-smoke-report.json` 和 `launcher-smoke-post-close.json`，原始 SHA 仍指向父代理实际核对的报告。
- Cookie / 学校恢复、撤销与更完整的生命周期业务分别属于 QUICKLOGIN-02/03；真实学校验收、原生权限、远端 CI 和发布尚未验证。

## Changed paths

共 28 个路径；产品运行源码改动 0，变更归属为 E2E / CI / 开发依赖 / 证据文档。

```text
.github/workflows/e2e.yml
.gitignore
docs/e2e/results/QUICKLOGIN-01.md
docs/e2e/results/evidence/QUICKLOGIN-01/final-validation.json
docs/e2e/results/evidence/QUICKLOGIN-01/launcher-smoke-post-close.json
docs/e2e/results/evidence/QUICKLOGIN-01/launcher-smoke-report.json
docs/e2e/results/evidence/QUICKLOGIN-01/negative-control.png
docs/e2e/results/evidence/QUICKLOGIN-01/publication-manifest.json
docs/e2e/results/evidence/QUICKLOGIN-01/success-popup.png
e2e.config.ts
e2e/README.md
e2e/auth-runtime.mjs
e2e/browser.ts
e2e/capability.e2e.ts
e2e/helpers.ts
e2e/journey.e2e.ts
e2e/launcher-smoke.mjs
e2e/lifecycle-check.mjs
e2e/lifecycle.mjs
e2e/network.mjs
e2e/noop-server.mjs
e2e/prepare-ci-artifacts.mjs
e2e/run.mjs
e2e/self-check.mjs
e2e/tsconfig.json
e2e/zero-check.mjs
package-lock.json
package.json
```
