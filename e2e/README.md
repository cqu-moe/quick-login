# QUICKLOGIN-01 / 02：真实扩展授权、学校 Cookie 与恢复

运行 `dist/` 中的真实 MV3 扩展、Chromium 持久上下文、真实 Auth Worker / D1 / DO 和 Auth 前端。授权为 authorization-code + S256 PKCE。QUICKLOGIN-01 保留六个授权/平台场景；QUICKLOGIN-02 增加十个真实学校绑定、原生容器、Cookie、回执与页面恢复场景。仅学校和邮件是外部合成替身；内部 Auth、D1/DO/Workflow、生产 Python 浏览器运行时和 Chrome Cookie API 均实际执行。

## 固定环境与入口

- Node.js `22.22.3`；`e2e@0.21.0`、`@e2e-dev/web@0.15.0`、`playwright-core@1.64.0` 已锁定。
- Auth 固定为 `870933794326b9d280dcf07f392c80c127fd7233`，且不得有 tracked 修改。默认只读使用本票独立副本 `QUICKLOGIN-03-deps/auth`；其他位置设置 `QUICKLOGIN_E2E_AUTH_PATH`。依赖负责人或 CI 需先完成该提交的根 `npm ci`、`frontend` 的 frozen pnpm install 和 build。runner 的 bundle、数据库和日志写入本票 `.e2e/`，不写依赖 checkout。
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

`run.mjs` 先通过固定框架的 JSON discovery 取得完整标题和 ID。六个授权场景共享原隔离 runtime；每个学校场景使用新的 Worker、D1/DO/Workflow、fixture 镜像、profile 和端口，防止批量合成注册消耗彼此的生产限频窗口。没有提高或清空限频。每组 exact title 选择与 selected/executed ID 集合一致；总报告再与发现集合核对。零选择仍实际经过单 runtime 的失败/清理路径。01/02 的两个完整调用各执行 16 项；包含03的全量发现24项。失败/跳过/中断或清理错误不能成为通过。

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

## QUICKLOGIN-03 生命周期与撤销

本票从02候选 `e6512e4cf7873828c31615243a010d800a4d6647` 起步，随后按父任务固定指令私有合并02终点 `169f0fecacca3c9d3f3224b27b896b740b02d6f1`，保留 beforeClose 精确指标和失败 transport 诊断。Auth870 不变；02的既有完整证明与03的新增证明分别记录。依赖和 Auth checkout 已物理 COW 复制到03专属目录，Git metadata 也独立。03没有生产成功开关或私有监听器调用；`src/`、manifest、版本和 lockfile 保持起点不变。

`device-lifecycle.e2e.ts` 与 `device-school.e2e.ts` 共八项，每项使用新 runtime、数据库、端口、profile；其中四项需要独占原生学校容器。框架默认负责浏览器生命周期、发现、报告及原生确认框，MV3/CDP 的既有能力例外保留。真实确认框只有 tester-army 一个处理者；额外原生 CDP 连接仅观察，避免其自动取消确认框。撤销必须有真实 DELETE 204、独立 Auth 读回和旧凭据拒绝，不能只看设备行消失。

连接及开关准备等待实际 connectIntent/pendingCommand 和公开按钮 aria-disabled 完成，再确认真实 enabledIntent。未等待 UI 动作结算时第二次 Space 曾被忙碌按钮忽略，表现为实际“已关闭”、无设备浏览器启动和 journal 断点超时；不以存储中写入 enabled/ready 绕过此竞争。

| 场景 | 新增的真实边界与可失败结果 |
| --- | --- |
| alarm / rotation / 503 | 本地仅过期已签发 access；代理对真实 token 请求返回 transport 503；设备身份保留；移除周期 alarm、实际 stopWorker，30秒原生 alarm 唤醒后重建周期 alarm、真实 Auth 轮换两种 token，reportEpoch 不变 |
| lost / expired grant | 删除实际 token 或负向过期真实 D1 grant；不 seed 授权；popup 明确重连，经真实官网 resume-ticket/OAuth 恢复原 deviceId/installationId，设备数不增 |
| late refresh | 持有真实 Auth refresh 响应；关闭同步保留已轮换 refresh，显式新 OAuth 授权后旧响应不能覆盖新 token/epoch |
| two installations / revoke | 两个独立 Chromium profile 各自完成 OAuth；实际设备页撤销一台；旧 resource 403 DEVICE_REVOKED / refresh 400 INVALID_GRANT，另一台仍能实际 refresh，网站会话可继续读 overview |
| Cookie journal / alarm | 在真正写入 TGC 后、journal completed 持久化前暂停，校验真 journal 和真 Cookie；手动替换精确域元组，实际 kill/原生 alarm 后回滚不覆盖手动值、无虚假成功 receipt；公开切换动作后新同步及学校业务通过 |
| pending ACK / alarm | 持有真实 ACK 响应，读到真实 pendingAck；停止 worker，由真实 alarm 恢复，重验证 Cookie 后补 ACK，同 exportId、无重复下载、独立网站回执和学校业务通过 |
| owned Cookie revoke | ready 后手动替换一项；真实撤销仅移除仍归扩展所有的 Cookie/token/receipt，保留手动值 |
| late ACK / report | 真实 ACK、reconcile 字节分别晚于关闭同步、新 OAuth 和设备退出，不能恢复旧 receipt/代际或覆盖手动 Cookie |

真实 alarm 等待期间 popup 导航到同扩展的静态 manifest，消除 popup 五秒轮询唤醒；只读 native storage 不发送产品消息。CDP 观察 stopped → running 的原生事件，唤醒时间不得早于实际 scheduledAt。journal 断点仅定位 TGC 崩溃边界，最终断言仍是 Cookie、journal、ACK 和业务读回。

TLS proxy 对本地 workerd 每次建立独立 HTTP socket，不使用 Node 默认 keep-alive 池。旧 refresh 的真实负读回曾连续在复用的 upstream 连接得到 ECONNRESET/代理502；fresh socket 探针恢复严格403 DEVICE_REVOKED/400 INVALID_GRANT。没有自动重试 token、替换成功响应或接受502；代理只保留方法、path、状态和 transport error code，便于失败分层。

```sh
QUICKLOGIN_E2E_OUTPUT=.e2e/quick03-round1 node e2e/run.mjs --grep '^QUICKLOGIN-03'
QUICKLOGIN_E2E_OUTPUT=.e2e/quick03-round2 node e2e/run.mjs --grep '^QUICKLOGIN-03'
npm run test:e2e:self-check
npm run test:e2e:zero
npm run test:e2e:lifecycle
npm run test:e2e:device-controls
QUICKLOGIN_E2E_PUBLISH_DIR=.e2e/published-quick03 node e2e/prepare-ci-artifacts.mjs quick03-round1 quick03-round2
```

`device-controls.mjs` 保持原测试断言，只通过真实 Chrome API 删除唤醒 alarm，或持有真实 reconcile ACK 响应。两次都必须因指定缺失结果失败、runner 1、清理通过，才能记录控制成功。collector 对包含03的两轮额外要求这些同源控制。既有 zero/startup/provider/primary+cleanup 控制仍要求通过。全量入口会发现既有01/02与03；上述两轮只证明03八项，不将继承02的完整验收冒称为03重跑。

原生权限 allow/deny 为独立 [人工待验清单](QUICKLOGIN-03-manual.md)，没有自动化通过声明。实际大学账号、日常浏览器、真实学校长时效和发布不在本票证明内。

学校 fixture 在固定 Auth Dockerfile 最后仅覆盖 Chromium executable wrapper，强制 headless/basic/mock-keychain 并 unset DISPLAY；不修改生产 Python 或 Auth checkout。外部 fixture 从实际 /proc cmdline 只汇总各 Chromium 主进程 PID 与安全参数布尔值，不保存完整参数或 profile 路径。邮件 poll 期间观察，wrapper 要求非空真实 launch 记录及四项参数成立。preDisposeProfiles/preDisposeChromeProcesses 是 dispose 前的在途快照，允许真实后台 Workflow 尚在执行；最终清理由 dispose 后的业务容器/proxy 独立 absence、独占镜像删除及宿主临时目录删除证明，不能把该快照称为最终残留或最终零值。beforeClose 的 finally 在 dispose 前 capture 业务名称，覆盖生产直接启动后业务对象先消失的 proxy 清理边界。

## Desktop / mobile viewport gate

`QUICKLOGIN_E2E_VIEWPORT=desktop`（默认）令实际 Auth / 学校页面为1440×900；`mobile` 为390×844。两者都加载同一个真实 Chromium MV3 扩展、复用全部业务断言。popup 保留产品390px宽度，测试页viewport为390×720；手机视口只表示窄屏布局，不代表手机Chrome扩展支持、触摸设备或真机验收。原生 OAuth 窗口和额外标签不继承框架当前页的viewport，因此共享页面入口在导航/输入前调用真实 Playwright viewport API，再独立读取页面 `innerWidth/innerHeight` 及 visualViewport。没有mock尺寸、修改学校响应或产品源码。

`artifacts/viewports.jsonl` 记录实际attempt ID、页面类型和无query的路径、预期/实际尺寸；不记录账号、Cookie或页面内容。runner将这些读回与真实selected attempts关联，缺少读回、错误target或尺寸均失败。每组保留框架JSON discovery，aggregate保留完整选择和各组读回。

CI矩阵为 `core/devices × desktop/mobile` 四个独立job，各跑两轮新环境和既有失败控制。`QUICKLOGIN_E2E_SUITE` 固定所需分片，collector核对实际discovery/selected/executed IDs、attempt/cleanup、原始dimensions、同viewport/源码/构建、两轮相同testIDs和不同run IDs；CI缺少显式suite亦失败。artifact名含suite及viewport。仅发现测试或旧桌面证据不能满足手机门禁。

```sh
QUICKLOGIN_E2E_VIEWPORT=mobile QUICKLOGIN_E2E_OUTPUT=.e2e/mobile-round-1 node e2e/run.mjs
QUICKLOGIN_E2E_VIEWPORT=mobile QUICKLOGIN_E2E_OUTPUT=.e2e/mobile-round-2 node e2e/run.mjs
QUICKLOGIN_E2E_VIEWPORT=mobile node e2e/self-check.mjs
QUICKLOGIN_E2E_VIEWPORT=mobile node e2e/zero-check.mjs
QUICKLOGIN_E2E_VIEWPORT=mobile node e2e/lifecycle-check.mjs
QUICKLOGIN_E2E_VIEWPORT=mobile node e2e/device-controls.mjs
QUICKLOGIN_E2E_VIEWPORT=mobile QUICKLOGIN_E2E_SUITE=all QUICKLOGIN_E2E_PUBLISH_DIR=.e2e/published-mobile node e2e/prepare-ci-artifacts.mjs mobile-round-1 mobile-round-2
```

将viewport改为desktop可运行相同桌面门禁。局部grep证明只属于其实际选择；CI collector要求完整分片。适用Web的Firefox/WebKit发布前补验、原生权限和独立live验收仍分别待验；本票不发布。
