# QUICKLOGIN-01 / 02：真实扩展授权、学校 Cookie 与恢复

运行 `dist/` 中的真实 MV3 扩展、Chromium 持久上下文、真实 Auth Worker / D1 / DO 和 Auth 前端。授权为 authorization-code + S256 PKCE。QUICKLOGIN-01 保留六个授权/平台场景；QUICKLOGIN-02 增加十个真实学校绑定、原生容器、Cookie、回执与页面恢复场景。仅学校和邮件是外部合成替身；内部 Auth、D1/DO/Workflow、生产 Python 浏览器运行时和 Chrome Cookie API 均实际执行。

## 固定环境与入口

- Node.js `22.22.3`；`e2e@0.21.0`、`@e2e-dev/web@0.15.0`、`playwright-core@1.64.0` 已锁定。
- Auth 固定为 `870933794326b9d280dcf07f392c80c127fd7233`，且不得有 tracked 修改。默认只读使用相邻 `QUICKLOGIN-02-deps/auth`；其他位置设置 `QUICKLOGIN_E2E_AUTH_PATH`。依赖负责人或 CI 需先完成该提交的根 `npm ci`、`frontend` 的 frozen pnpm install 和 build。runner 的 bundle、数据库和日志写入本票 `.e2e/`，不写依赖 checkout。
- Chromium 通过 `npx --no-install e2e-web install chromium --with-deps` 预装；安装浏览器本身不会启动浏览器。
- 学校旅程要求可用 Docker。先在固定 Auth checkout 运行 `node e2e/school/build.mjs` 构建生产浏览器基础镜像，再拉取 `cloudflare/proxy-everything:3cb1195@sha256:0ef6716c52430096900b150d84a3302057d6cd2319dae7987128c85d0733e3c8`。每个学校旅程基于该镜像构建独占 fixture 镜像，结束后删除自己的容器和镜像；缺少 Docker/镜像直接失败。
- `openssl` 用于生成每轮独立的短期 TLS 证书。浏览器中的 `https://auth.cqu.moe` 保持原 origin，由本地代理送往本轮真实 Auth；`sso.cqu.edu.cn` 送到同一真实设备容器中的合成学校，不访问生产。SPKI 只放行本轮证书，不关闭全局 TLS 校验。
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

外部浏览器流量仅放行到本轮 Auth 和合成 SSO 的代理连接；Chromium 内建服务及 identity 回调的已知拒绝单独登记，其余请求拒绝且令运行失败。Worker 仅允许合成 `example.test` 邮件投递，其他外联失败。遥测及 AI 调用关闭。

`self-check` 必须失败于指定的真实断言并返回 runner 1；`zero-check` 必须得到 `NO_TESTS` / runner 2。`lifecycle-check` 实际验证依赖缺失、成功测试后的残留 profile 清理拒绝、主失败与清理失败同时保留，以及 provider 清理错误。只放入并移除自己的合成残留文件，不修改产品或替换内部服务。控制脚本仅在预期失败原因和清理证据均吻合时返回 0。

固定 e2e 0.21 可能将 provider 清理失败记为 attempt secondary error，同时仍返回 passed / exit 0；必过 wrapper 会独立检查该记录并失败。专用负控制在实际资源已移除后注入 provider 错误，证明无需依赖残留文件也会拒绝。Linux 原生运行曾在 Chromium 退出后删除 Default 目录时得到 ENOTEMPTY；现在使用有上限的原生删除重试，持续残留仍失败。后台浏览器组件请求被启动参数抑制，代理继续拒绝并记录所有未登记外联。

每轮输出 runner report / log、步骤日志、输入遮罩截图及 `runtime.json`。runtime 记录构建提交、Auth 提交、网络结果和清理结论；只观察 OAuth 跳转元数据，不保存响应正文、code、token 或 Cookie。TLS proxy 请求 identity 编码，避免把 gzip 字节误当 JSON。输出包含本地运行数据，不直接整体上传。

`prepare-ci-artifacts.mjs` 在 CI 失败后仍执行，保留已存在的报告与失败截图，剔除 DB、DO / Worker bundle、TLS 和 profile，并清理文本 URL query / 凭据。缺少通过的两轮或失败控制时，生成可检查的 sanitization 报告后非零退出。已有产物目录不覆盖。

Chromium 桌面扩展 E2E 不代表手机真机、权限弹窗、完整后台生命周期 / 撤销（QUICKLOGIN-03）或真实学校验收（QUICKLOGIN-04）。本地 CI 模式与远端 GitHub Actions 分别记录；固定 Auth 提交可远端获取之前，不能声称远端 CI 已通过。


## QUICKLOGIN-02 的十个行为边界

`run.mjs` 先通过固定框架的 JSON discovery 取得完整标题和 ID。六个授权场景共享原隔离 runtime；每个学校场景使用新的 Worker、D1/DO/Workflow、fixture 镜像、profile 和端口，防止批量合成注册消耗彼此的生产限频窗口。没有提高或清空限频。每组 exact title 选择与 selected/executed ID 集合一致；总报告再与发现集合核对。零选择仍实际经过单 runtime 的失败/清理路径。两个完整调用各执行 16 项，失败/跳过/中断或清理错误不能成为通过。

| 场景（学校用例按此契约归属） | 可信回归及真实断言 |
| --- | --- |
| `school.e2e.ts` 绑定→Cookie→业务→ACK | 学校表单改写辅助 Cookie 后旧 receipt 被误认为新会话；实际域、hostOnly、path、session、SameSite、有效期及过滤结果；真实新登录和导出后，延迟真实 ACK 响应期间不得导航，随后学校业务标题与独立 Auth overview 的 receipt 一致 |
| foreign cookies | 原生 Cookie API 中 host/domain/path 三种同名外来 TGC；同步冲突及关闭后都保留外来值，不能取得本地成功回执 |
| manual typing | 真实表单输入切换手动模式；迟到的真实容器登录不能导航或恢复 receipt，页面有手动/重试入口 |
| sync off / late export | 持有已由真实 Auth 生成的 export 响应；真实 popup 关闭意图先提交，释放后不写 Cookie、不发成功回执，服务端设备关闭 |
| two documents | 两个真实标签等待同一新写入；每个文档恰好导航一次且 ACK 完成 |
| document replacement | 等待时替换真实文档；让实际新登录/ACK 完成后，替换后的 URL 不变且无旧导航，不要求内部记录立即消失 |
| expired export | CDP 在实际扩展即将检查真实 export 有效期时暂停，真实等待 31.5 秒再恢复；STALE_SNAPSHOT、无 TGC、本地/服务端无成功 receipt、真实 receipts 请求数不增加 |
| repeated login form | 外部学校仍拒绝新会话；恰好一次导航后停止、明确手动/重试入口，跨后续轮询不重复刷新 |
| wrong generation receipt | 实际签发过的旧 receipt 在真实设备关闭增代后重放；真实 Auth 拒绝 STALE_SNAPSHOT，当前设备仍关闭，本地无 receipt |
| interrupted Cookie write | 原生 Chrome API 已写 Cookie、journal 未完成时实际停止 service worker；重启后回滚半写入，无成功 ACK，然后新的真实同步和学校业务恢复 |

既有 cookie-store/sync/school-recovery/content 单测保护纯逻辑、排序和更多小型输入组合；这些 E2E 独占真实 Chrome、容器、HTTP 和文档生命周期边界，不能被 fake Chrome/fetch 单测替代。没有为测试增加生产开关或成功状态注入。唯一生产修复位于 sync：辅助 Cookie 验证失败而 TGC 仍在时保留学校已经拒绝的版本；TGC 确实缺失时保留既有重写能力。相应真实学校回归在修复前失败，修复后通过；原缺失 TGC 单测继续保留。

学校替身沿用固定 Auth 的真实 Container/Workflow 观察 wrapper 和 Dockerfile，增加私有外部学校 HTTP transport 及业务页。学校浏览器和扩展浏览器访问同一个设备学校会话注册表；不伪造 chrome.cookies、不 mock 内部 Auth、不 seed ready。准备仅包括合成邀请/验证账号、经实际强认证管理员 quota preview/apply 授予额度、经实际学校绑定入口完成前置绑定。准备会话不注入扩展，扩展仍走真实 OAuth。

延迟门只持有真实 upstream 响应字节，不修改内容。CDP 断点仅定位实际构建的时间/崩溃边界，不作为通过判据；若无法定位，运行失败。实际 Cookie、journal、原生 worker 停止/重启、页面导航及服务端读回才是断言。框架能力缺口与 QUICKLOGIN-01 一致，继续使用同一受管 headless 浏览器的 CDP；没有另开浏览器或放宽 profile/keychain 限制。

每组清理停止邮件 pump、workerd/容器、服务和 profile，移除独占 SQLite/bundle/TLS/image。原生 egress proxy 必须通过固定 Auth 的 schoolContainerCleanup 合同回收：在每次私有 fixture DO fetch 前登记实际 worker/DO ID，关闭时只收集本轮唯一镜像的业务容器及其精确名称对应的 proxy，校验固定 interceptor 镜像且无挂载后停止/删除，并分别独立查询业务及 proxy 的 absence。runtime 记录 removedContainerIds、removedProxyIds 和 proxyObjectsRemoved；仅业务镜像删除不算完整清理。旧环境 orphan 的“停止保留”不等于删除，不能纳入本轮回收成功计数。`runtime.json` 的 groups 保存逐组源提交、学校浏览器结果及清理证据；collector 要求各组都是同一固定干净源码/构建。完整后台 alarm、撤销/兄弟设备生命周期由 QUICKLOGIN-03 负责；真实大学账号、真实学校、原生权限界面和用户日常安装由独立验收负责。合成学校业务通过不等于真实学校通过。

原生停止入口为 Chromium [ServiceWorker.stopWorker](https://chromedevtools.github.io/devtools-protocol/tot/ServiceWorker/#method-stopWorker)，以实际 workerVersionUpdated 的 versionId 调用并观察 stopped，再由真实 popup 消息唤醒。曾实际探测 chrome.runtime.reload：命令行加载的未上架扩展在当前 Chromium 中会被停用，故不把该失败探针当作可用的 worker 恢复入口。

学校 fixture 在固定 Auth Dockerfile 最后仅覆盖 Chromium executable wrapper，强制 headless/basic/mock-keychain 并 unset DISPLAY；不修改生产 Python 或 Auth checkout。外部 fixture 从实际 /proc cmdline 只汇总各 Chromium 主进程 PID 与安全参数布尔值，不保存完整参数或 profile 路径。邮件 poll 期间观察，wrapper 要求非空真实 launch 记录及四项参数成立。preDisposeProfiles/preDisposeChromeProcesses 是 dispose 前的在途快照，允许真实后台 Workflow 尚在执行；最终清理由 dispose 后的业务容器/proxy 独立 absence、独占镜像删除及宿主临时目录删除证明，不能把该快照称为最终残留或最终零值。beforeClose 的 finally 在 dispose 前 capture 业务名称，覆盖生产直接启动后业务对象先消失的 proxy 清理边界。
