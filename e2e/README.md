# QUICKLOGIN-01：真实扩展授权与设备登记

运行 `dist/` 中的真实 MV3 扩展、Chromium 持久上下文、真实 Auth Worker / D1 / DO 和 Auth 前端。授权为 authorization-code + S256 PKCE。仅邮件投递为合成替身；本票不绑定学校账号，不运行学校登录或容器旅程。

## 固定环境与入口

- Node.js `22.22.3`；`e2e@0.21.0`、`@e2e-dev/web@0.15.0`、`playwright-core@1.64.0` 已锁定。
- Auth 固定为 `d9bf0c5e6d5cc459029da6a345991b8d0f13f514`，且不得有 tracked 修改。默认只读使用相邻 `AUTH-01`；其他位置设置 `QUICKLOGIN_E2E_AUTH_PATH`。依赖负责人或 CI 需先完成该提交的根 `npm ci`、`frontend` 的 frozen pnpm install 和 build。runner 的 bundle、数据库和日志写入本票 `.e2e/`，不写依赖 checkout。
- Chromium 通过 `npx --no-install e2e-web install chromium --with-deps` 预装；安装浏览器本身不会启动浏览器。
- `openssl` 用于生成每轮独立的短期 TLS 证书。浏览器中的 `https://auth.cqu.moe` 保持原 origin，由本地代理送往本轮真实 Auth，不访问生产。SPKI 只放行本轮证书，不关闭全局 TLS 校验。
- 扩展 ID 固定为 `igfidegfgfoofnoncpmbcokbffjmmook`。OAuth client 登记该扩展的 chromiumapp 回调，真实授权窗口完成返回；不模拟 callback，不预置 token，不注入 Chrome fake。

```sh
VITE_POSTHOG_PROJECT_TOKEN='' VITE_POSTHOG_HOST='' npm run build
npm run typecheck:e2e
QUICKLOGIN_E2E_OUTPUT=.e2e/my-run-1 node e2e/run.mjs
QUICKLOGIN_E2E_OUTPUT=.e2e/my-run-2 node e2e/run.mjs
npm run test:e2e:self-check
npm run test:e2e:zero
npm run test:e2e:lifecycle
QUICKLOGIN_E2E_PUBLISH_DIR=.e2e/published-my-run node e2e/prepare-ci-artifacts.mjs my-run-1 my-run-2
```

运行目录必须为本票 worktree，输出目录必须全新，不能复用已有运行。构建 provenance 的 sourceCommit 必须与 HEAD 一致。`npm run test:e2e` 是类型检查及 runner 的快捷入口，不隐式构建。

## 六个业务 / 平台用例

1. tester-army 持久 context 加载真实 MV3 worker 和 popup；同时实际探测扩展 URL 导航能力。
2. popup 发起真实 Auth PKCE 登录，独立读回 D1 设备投影、grant 及 popup 显示；同一旅程实际验证 Auth 根页面的恢复消息拒绝、非允许 origin 没有外部消息能力。
3. 用户关闭真实登录窗口后没有设备、grant 或可用 token，popup 回到未连接。
4. 仅破坏本地 pending state，真实 Auth 已签发 code，但扩展不兑换 token、不登记设备，并清除 pending PKCE。
5. 更改本轮 client 的允许回调后，从真实 Auth 读到 `invalid_redirect`，再关闭错误页；不能将普通取消当作回调拒绝。
6. 损坏本地安装元数据后，OAuth 仍真实成功，但真实注册 API 返回 422，设备投影及 popup 不显示连接成功。

新账号的总开关默认关闭，因此成功登记后 popup 为“快捷登录已暂停”，不是学校“已就绪”。不会 seed 被测设备、OAuth token 或连接成功状态。账号通过真实邀请注册、邮件验证创建，准备会话不交给浏览器；实际登录仍经 Auth 页面。

## 框架与平台边界

tester-army 负责 BrowserProvider 生命周期、popup 的确定性点击和可见状态断言、报告、失败 trace。固定版本的导航 API 实跑拒绝 `chrome-extension:`（`POLICY_DENIED`），配置模块导入的 `surfaceOf` 不属于当前 attempt，原生 OAuth 窗口也不会成为其 active tab；对应失败探针保留在票报告中。只对扩展 URL 导航、原生 OAuth 窗口、Chrome API 与实际 worker / 持久数据读回使用同一浏览器的 Playwright CDP。没有迁移其他测试。

所有启动都经过 `browser.ts`，无条件使用 `--headless=new --password-store=basic --use-mock-keychain` 和本轮 `.e2e/.../profiles/chromium-*`。没有 headed 或默认 profile fallback。lease 交付前失败由 launcher 的 `finally` 清理；成功 lease 由 runner release。钥匙串事故及单次独立 PID 清理 smoke 见 `docs/e2e/results/QUICKLOGIN-01.md`。

## 失败门禁与产物

外部浏览器流量仅放行到本轮 Auth 的代理连接；Chromium 内建服务及 identity 回调的已知拒绝单独登记，其余请求拒绝且令运行失败。Worker 仅允许合成 `example.test` 邮件投递，其他外联失败。遥测及 AI 调用关闭。

`self-check` 必须失败于指定的真实断言并返回 runner 1；`zero-check` 必须得到 `NO_TESTS` / runner 2。`lifecycle-check` 实际验证依赖缺失、成功测试后的残留 profile 清理拒绝、主失败与清理失败同时保留，以及 provider 清理错误。只放入并移除自己的合成残留文件，不修改产品或替换内部服务。控制脚本仅在预期失败原因和清理证据均吻合时返回 0。

固定 e2e 0.21 可能将 provider 清理失败记为 attempt secondary error，同时仍返回 passed / exit 0；必过 wrapper 会独立检查该记录并失败。专用负控制在实际资源已移除后注入 provider 错误，证明无需依赖残留文件也会拒绝。Linux 原生运行曾在 Chromium 退出后删除 Default 目录时得到 ENOTEMPTY；现在使用有上限的原生删除重试，持续残留仍失败。后台浏览器组件请求被启动参数抑制，代理继续拒绝并记录所有未登记外联。

每轮输出 runner report / log、步骤日志、输入遮罩截图及 `runtime.json`。runtime 记录构建提交、Auth 提交、网络结果和清理结论；只观察 OAuth 跳转元数据，不保存响应正文、code、token 或 Cookie。TLS proxy 请求 identity 编码，避免把 gzip 字节误当 JSON。输出包含本地运行数据，不直接整体上传。

`prepare-ci-artifacts.mjs` 在 CI 失败后仍执行，保留已存在的报告与失败截图，剔除 DB、DO / Worker bundle、TLS 和 profile，并清理文本 URL query / 凭据。缺少通过的两轮或失败控制时，生成可检查的 sanitization 报告后非零退出。已有产物目录不覆盖。

Chromium 桌面扩展 E2E 不代表手机真机、权限弹窗、Cookie / 学校恢复（QUICKLOGIN-02）、后台生命周期 / 撤销（QUICKLOGIN-03）或真实学校验收（QUICKLOGIN-04）。本地 CI 模式与远端 GitHub Actions 分别记录；固定 Auth 提交可远端获取之前，不能声称远端 CI 已通过。
