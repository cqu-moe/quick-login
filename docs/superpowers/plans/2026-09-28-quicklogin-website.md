# QuickLogin 官网与受控下载 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本计划推荐在当前会话中顺序执行，方法由用户审阅后选择。

**执行状态（2026-09-28）：** 任务 1—5 的实现与本地验证已完成；任务 6 的本地检查和独立复核已完成，云端初始化、推送、CI 实跑及生产身份验收仍待执行。详细证据见 `docs/acceptance/quicklogin-website.md`。

**Goal:** 交付 quicklogin.cqu.moe 五页官网、Auth 内测鉴权下载、私有 R2 安装包及标签触发的自动发布流程。

**Architecture:** 官网在 QuickLogin 仓库独立静态构建；Auth 复用现有会话与资格来源，公开发布元数据，鉴权后流式返回私有 R2 ZIP。CI 上传不可变版本并验证后切换 canary 指针，官网和下载接口读取同一发布记录。

**Tech Stack:** 现有 Vite、TypeScript、普通 CSS、Vitest；Auth 现有 Hono、Better Auth、D1、Workers/R2；GitHub Actions；Python 标准库打包与发布编排，AWS CLI 执行 S3 请求，不向扩展运行时添加发布依赖。

**Spec:** `docs/superpowers/specs/2026-09-28-quicklogin-website-design.md`（2026-09-28 用户已确认）。

## Global Constraints

- 介绍公开，下载仅面向 Auth 登录且具有 QuickLogin 内测资格的用户。
- 三个业务文案固定为“请登录后下载”“下载”“内测中，暂未开放”；没有申请入口、候补名单或无资格下载通道。
- 登录后回到官网原下载页面，用户再次点击才下载。资格查询失败不得转换为无资格。
- 私有 R2 + Auth 每次下载鉴权；不提供 signed URL、公开桶或公开 GitHub ZIP 附件。
- ZIP 仅包含扩展 dist 内容；网站输出 website/dist，不混入扩展安装包。
- 推送 vX.Y.Z 标签才自动发布插件；官网 main 部署与插件发布分开。
- 不做自动更新、本地更新助手、插件内新版检查或商店上传。
- 根 package.json、package-lock.json、public/manifest.json 版本一致；本功能计划以 0.4.0 为首个候选版本，执行前核对当前 main，若已占用则按发布规则取下一个未使用版本，不能覆盖旧包。
- 不改学校登录与会话同步机制；只读学校及账号现场，验收不要求读取学校密码或 Cookie。
- 隔离工作区内实施；每次提交前检查有效 git user.name/user.email，不覆盖身份；只提交任务文件。
- 初次部署、R2 初始化与包发布分别记录；生产写入前展示具体目标并取得尚未具备的授权。用户确认执行计划不等于授权 Chrome Web Store 发布。

## Review Focus

1. 页面展示 vA 后 CI 发布 vB，点击仍下载 vA，文件摘要必须匹配（任务 2、3）。
2. 页面显示可下载后退出登录或撤销资格，直接下载不能取得文件（任务 2）。
3. 恶意版本参数、缺失/损坏发布记录不能选择任意桶对象或注入附件文件名（任务 1、2）。
4. 两个标签发布顺序颠倒、重复执行、R2 校验失败不得覆盖历史包或错误降级（任务 4）。
5. 官网凭据 CORS、二次验证返回、页面焦点刷新及网络错误不能误报业务状态（任务 2、3、6）。

## 工作区与文件分工

- EXT 已建立：`/Users/uu/.codex/worktrees/quicklogin-website/quicklogin`，目前 detached HEAD，只有设计文档变更；开始实施时创建 `codex/quicklogin-website` 分支。
- AUTH 首选现有 `/Users/uu/Developer/cqu-moe/auth/.worktrees/quicklogin-implementation`：本次检查干净，但基线较旧。执行前确认没有其他任务使用，保留原分支并从最新 Auth main 建立本任务分支；不直接覆盖旧分支或假定工作区一直空闲。
- 文件分为发布脚本、Auth 接口、静态官网三组。每组具有独立验证门禁；它们共享下面的发布 JSON 合同，不新建跨仓库 SDK。

### 发布合同

私有记录 `quicklogin/releases/<version>/release.json` 与 `quicklogin/channels/canary.json` 使用同一完整结构：

```ts
interface ReleaseRecord {
  schemaVersion: 1;
  channel: 'canary';
  version: string;
  filename: string;           // cqu-quicklogin-<version>-canary.zip
  objectKey: string;          // quicklogin/releases/<version>/<filename>
  size: number;
  sha256: string;
  sourceCommit: string;
  protocolVersion: number;
  contractDigest: string;
  publishedAt: string;        // ISO 8601
  notes: string[];
}
```

CI run 链接放发布报告，不进入决定包身份的字段。同一版本重跑保留首次发布的 publishedAt，验证版本、来源及文件摘要，不因 run 或时间变化覆盖记录。

公开 `GET /api/v1/cqu/quicklogin/release?version=X.Y.Z` 返回 `{ data: { version, filename, size, sha256, publishedAt, notes } }`；省略 version 时读取当前指针。未初始化当前版本返回 503，指定不存在的合法版本返回 404，参数非法返回 400。所有输入和从 R2 读到的记录都验证；公开响应不含 objectKey 或凭据。

受控 `GET /api/v1/cqu/quicklogin/download?version=X.Y.Z` 先验证 session 和资格，再读取指定版本。省略版本可读取当前版本；页面始终携带已展示版本。401/403/400/404/503 区分；HTML 导航提供可读错误及固定官网返回入口，JSON 调用按 Auth problem 格式返回。显式处理 Accept，避免错误格式依赖偶然中间件行为。

## Task 1: 版本化 ZIP 与发布记录

**Files:** Create `scripts/release.py`, `scripts/test_release.py`; Modify `package.json`（scripts）, `docs/operations/quicklogin-release.md`。

**Interfaces:** CLI `python3 scripts/release.py build --tag vX.Y.Z --notes <file> --output releases` 输出 ZIP 和 release.json。`build_release(repo: Path, tag: str, notes: list[str], output: Path) -> dict` 返回上述记录；重复包路径不覆盖。

- [ ] 写一个标准库 unittest 测试组：构造最小合成 dist，断言 ZIP 根包含 manifest.json 而不包含 dist/；三个版本与 tag 不符时报错；build-info 不等于 Git HEAD 报错；源映射/私密文件由既有门禁拒绝；修改文件 mtime 后同输入 ZIP SHA-256 不变；已有不同 ZIP 拒绝覆盖。
- [ ] 运行 `python3 -m unittest discover -s scripts -p 'test_release.py'`，确认新功能用例因未实现失败。
- [ ] 用 Python zipfile、hashlib、json、subprocess 完成最小脚本；文件名排序，固定 ZIP 时间和文件权限，拒绝符号链接，验证 CRC、每个条目内容与 SHA-256。调用既有 check:package，不复制其业务规则。发布说明从标签对应源码中的说明文件传入，不从日志猜测。
- [ ] 运行测试与 `npm run typecheck`、`npm test`、`npm run build`、`npm run check:package`；在非 releases 历史路径生成一个临时验证包并独立检查 manifest、build-info、ZIP 完整性与摘要。
- [ ] 检查 Git 身份，提交打包脚本与对应测试，提交信息建议 `build: add verified versioned extension packaging`。

## Task 2: Auth 公开版本与鉴权下载

**Files:** Create `AUTH/src/api/v1/quicklogin-downloads.ts`, `AUTH/src/api/v1/quicklogin-downloads.schema.ts`, `AUTH/src/services/quicklogin/releases.ts`, `AUTH/test/do/quicklogin-downloads.test.ts`; Modify `AUTH/src/services/quicklogin/eligibility.ts`, `AUTH/src/routes/cqu-quicklogin.ts`, `AUTH/src/api/v1/index.ts`, `AUTH/src/app.ts`, `AUTH/src/types.ts`, `AUTH/wrangler.jsonc` 及生成的 API 文档。测试复用 `AUTH/test/do/api-fixture.ts` 和现有 workers pool。

**Interfaces:** `createQuickloginDownloadsApi()` 挂载上述 /release、/download 两条路由；`readRelease(bucket: R2Bucket, version?: string): Promise<ReleaseRecord>` 校验私有记录；`hasQuickloginAccess(env: Env, userId: string): Promise<boolean>` 保留设备模式和旧模式现有资格语义；binding 为 `QUICKLOGIN_RELEASES`。具体桶名首次初始化时核对后配置，不猜测现有云资源。

- [ ] 在既有 API fixture 下写失败测试：公开元数据无登录可读；无 session 下载 401；session 无资格 403；有资格返回完全相同合成 ZIP 和 attachment/no-store；同一会话撤销资格后拒绝；Authorization bearer 不能替代或绕过 session-only 约定。
- [ ] 增加边界断言：HEAD 同样鉴权；非法 `../`、编码斜杠、重复 version 或任意 URL 为 400；缺失对象 404、损坏元数据及 R2 错误 503；从 vA 页面下载 vA 时当前指针即使变为 vB，仍返回 vA；没有版本静默回退。
- [ ] 运行 `npm run test:do -- test/do/quicklogin-downloads.test.ts`，确认失败源于未实现。
- [ ] 遍历资格判断调用者，提取 GET 与下载共用资格函数：设备模式委托 hasQuickloginPolicy，旧模式沿用 quicklogin_access。关闭用户总开关、设备额度已满都不能被重新解释为无内测资格；现有设置读写回归继续通过。
- [ ] 实现版本路由与流式下载。公开响应裁剪内部字段；ZIP MIME、附件文件名由已验证记录生成；禁用公共缓存，不把完整 ZIP 缓冲进 Worker。错误 HTML 文案固定并转义，不注入原始参数。路由不受其他设备 bearer-only 中间件误拦。
- [ ] 为官网 origin 与资格查询路径添加精确凭据 CORS：`Access-Control-Allow-Origin: https://quicklogin.cqu.moe`、`Access-Control-Allow-Credentials: true`、`Vary: Origin`。保持其他来源和设备路由行为不变；测试预检、GET、错误响应、恶意来源无凭据授权。公开版本查询可无凭据请求。
- [ ] 运行新旧 QuickLogin 集成测试、两套 typecheck、单元测试及 `npm run generate:api`、`npm run check:api`、`npm run lint:api`、`npm run check:boundaries`。从真实 createApp 路径测试 CORS 和路由，不仅测试子路由。
- [ ] 检查身份并提交最小 Auth 变更；本任务不部署，提交信息建议 `feat: serve authenticated QuickLogin releases from R2`。

## Task 3: 五页官网与三态下载

**Files:** Create `website/index.html`, `website/download/index.html`, `website/faq/index.html`, `website/privacy/index.html`, `website/changelog/index.html`, `website/src/main.ts`, `website/src/download.ts`, `website/src/download.test.ts`, `website/src/style.css`, `website/public/` 中实际引用的静态资源、robots.txt、sitemap.xml、更新 RSS；Create `website/vite.config.ts`, `website/tsconfig.json`; Modify `package.json`, `vitest.config.ts`。Vite 与测试工具复用根依赖，不引入 React/CMS。

**Interfaces:** `DownloadState = 'signedOut' | 'eligible' | 'ineligible'`；暂态 loading/error 单独表示。`loadDownloadState(signal: AbortSignal): Promise<DownloadState>` 请求现有资格接口；401→signedOut、200 data.eligible===true→eligible、200 data.eligible===false→ineligible，其他响应抛错。每次查询取消旧请求，防止旧结果覆盖新状态。

- [ ] 加载并执行 emil-marketing-pages、emil-design-foundations；实施 HTML/CSS/客户端 JS 前按 modern-web-guidance 检索相关规范。沿用普通 CSS、系统字体与现有盾形品牌，先实现五页可访问静态内容。
- [ ] 写一个下载交互测试组：三个固定文案精确匹配；网络错误显示重试而非无资格；Auth 登录链接只回本站固定下载页；登录返回不自动下载；vA 下载链接带 version=vA；页面重获焦点时重查，旧响应不能覆盖新状态。
- [ ] 运行 `npm test -- website/src/download.test.ts` 确认失败；更新 vitest include 与单独网站 tsconfig，使官网代码确实被测试和类型检查覆盖。
- [ ] 实现凭据状态查询、公开发布信息读取、三态 CTA 与状态反馈。无资格没有下载 href；可下载使用 Auth URL 的普通链接，不 fetch 整包。登录入口沿用 `/login?redirect=...` 并验证实际二次验证导航；所有页面 CTA 统一行为。
- [ ] 编写已核验功能与安装图文、隐私及更新说明；截图来自真实插件或明确标注的合成演示，不展示账号。手机说明桌面安装条件，但不新增第四种资格状态。提供当前版本校验信息、可复制的确有需要的命令/地址。
- [ ] 加入页面 title/description、canonical、静态导航、404、站点地图和更新 RSS；加载图片尺寸固定，资源缺失构建失败。无滚动入场或自动轮播；键盘焦点、触摸尺寸、减少动态效果可用。
- [ ] 运行 `npm run typecheck:website`、`npm test`、`npm run build:website`；验证五条页面路由与站内链接，网站输出在 website/dist。重新检查扩展包未包含官网内容。
- [ ] 检查身份并提交，建议 `feat: add QuickLogin website and gated download flow`。

## Task 4: 不可变 R2 发布与回滚脚本

**Files:** Extend `scripts/release.py`, `scripts/test_release.py`; Update `docs/operations/quicklogin-release.md`。

**Interfaces:** `publish --record <release.json> --bucket <name> --endpoint <https-url>`；`rollback --version X.Y.Z --bucket <name> --endpoint <https-url>`。AWS CLI 用环境变量读取 R2 凭据，脚本不实现 SigV4，不输出密钥；固定 region=auto。CLI 版本必须支持条件 PutObject，并在 CI 中固定和检查版本。

- [ ] 使用 unittest mock subprocess，验证上传顺序：ZIP 和版本记录→远端读回摘要→更新指针；已有对象相同则复用，不同则失败；任意上传/读回失败不更新指针；版本 0.10.0 排在 0.9.0 之后；旧任务不能降级；回滚拒绝未验证目标。
- [ ] 运行脚本测试确认失败。
- [ ] 实现不可变对象的 `If-None-Match: *` 条件写入；对象存在则下载校验，不能“先查询然后无条件覆盖”。当前指针用读得的 ETag 做 `If-Match` 更新，首次写用不存在条件；冲突后重新读取，禁止盲写。遇到现有损坏指针时停止而不是当作初次发布。
- [ ] 发布前后验证 ReleaseRecord；全量远端 ZIP SHA-256 读回验证。自动提升拒绝低于当前版本，回滚为显式独立命令且同样条件写入。记录输出包含旧/新版本、对象摘要与阶段，不泄露凭据。
- [ ] 运行 `python3 -m unittest discover -s scripts -p 'test_release.py'`；在本地合成服务或测试桶验证真实 AWS CLI 条件参数。测试桶写入需适用授权，不使用生产桶实验。
- [ ] 检查身份并提交，建议 `build: publish immutable QuickLogin packages to private R2`。

## Task 5: GitHub Actions 与官网部署

**Files:** Create `.github/workflows/check.yml`, `.github/workflows/website.yml`, `.github/workflows/release.yml`, `.github/workflows/rollback.yml`, `website/wrangler.jsonc`; Modify `package.json`, `package-lock.json`, `public/manifest.json`, `.gitignore`, 发布与交接文档。若需 Wrangler，作为构建 devDependency 明确固定版本，不进入扩展包。

**Interfaces:** checks 无 secrets；website 使用 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`；release/rollback 使用环境隔离的 `R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY` 与 vars `R2_BUCKET`、`CLOUDFLARE_ACCOUNT_ID`。不存在的 secret 只列初始化需求，不输出或臆造值。

- [ ] 为检查工作流配置 PR/push、最小 contents:read 权限、锁文件安装和全部质量门禁；不使用 pull_request_target 运行不可信代码。Action 固定已核验的版本/提交，运行时按现有 Vite 支持范围选择并固定。
- [ ] 官网独立配置为 Workers 静态资源，自定义域名 quicklogin.cqu.moe，无 SPA fallback 吞掉不存在路径。main 仅官网及相关构建文件变化触发，部署前构建和检查；发布元数据运行时读取，因此发插件包不需要部署网站。
- [ ] 发布工作流监听 v*，脚本再做严格 vX.Y.Z 校验及标签提交属于 main 的检查。完整门禁→一次构建→build→publish，发布该次验证过的 ZIP，不二次构建不同产物。固定并发组 `quicklogin-canary-publish`，`cancel-in-progress: false`，版本/ETag 校验负责最终一致性。
- [ ] 手动 rollback 工作流只接受明确版本，在同一并发组执行脚本并生成回滚报告；不能绕过既有生产环境访问控制。标签发布不自动创建或推送新标签。
- [ ] 增加发布 summary 与持久 release.json，生成运维记录供审阅；不能因回写 main 触发另一轮插件发布。不把 ZIP 作为公开 Actions artifact/Release 附件，也不输出直链。
- [ ] 版本升为首个未占用 minor；检查三处版本相同，验证所有工作流事件/路径条件、失败依赖和打包文件范围。用本地检查加 CI 验证 YAML，逐个证明 PR 不持有发布凭据、普通 main push 不发布 ZIP、匹配标签才发布。
- [ ] 运行 EXT 全部规定门禁及脚本/官网检查，检查身份并提交，建议 `ci: release QuickLogin packages on version tags`。

## Task 6: 整体验收与首次上线交接

**Files:** Update `docs/operations/quicklogin-release.md`, `docs/operations/quicklogin-handoff.md`, `docs/acceptance/quicklogin-website.md`；需要修正时只改对应任务文件。

- [ ] 启动本地官网及 Auth，提供合成三态演示；浏览器检查五页、下载状态、网络失败重试、焦点刷新、桌面/手机、键盘与减少动态效果。测试截图与账号脱敏；执行 emil-ui-review。不得把模拟状态说成真实 Auth 业务验收。
- [ ] 复核登录→二次验证（账号启用时）→原下载页→点击下载全链；无登录复制链接拒绝、无资格显示精确文案、有资格包摘要匹配。真实验收只在有明确授权的测试会话进行，不为了测试增删真实用户权益。
- [ ] 一次性检查实际 Cloudflare 账户、目标桶、域名、仓库环境与凭据可用性；具体列出资源名称和最小权限，先完成代码、预览和测试再处理尚缺的生产写入授权。不得安装到或重载用户日常 Chrome。
- [ ] 首次上线顺序：配置私有 R2 和 CI secrets/bindings→部署 Auth 并验证未发布版本的错误状态→在 main 合入审核通过版本→推送明确版本标签触发发布→读回包和指针→部署/验证官网。首次标签推送也是生产发布，不擅自借测试标签触发。
- [ ] 发布后记录 Auth commit/Worker version、EXT commit/tag、官网部署版本、R2 key、ZIP SHA-256、CI run 和真实验收结果；任何未完成项写明，不声称上线或业务通过。
- [ ] 跑一次最终必要门禁：EXT 四项规定检查、网站类型/构建、脚本测试；AUTH 路由/DO、API artifacts 和现有部署 CI。通过后不无故重复全套。
- [ ] 完成分支整体复核，修正实际发现；确认提交身份后提交最终证据。保留仍用于后续工作的 worktree，不因一次发布随意归档。

## 实施前查阅

- R2 条件写入：https://developers.cloudflare.com/r2/api/s3/api/
- R2 下载：https://developers.cloudflare.com/r2/objects/download-objects/
- GitHub Actions 标签触发：https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- 实施时以最新官方文档确认 CLI 参数与 Action 版本，先 Context7，必要时官方来源；不照搬未经验证的命令。

## 计划自检

设计的五类页面、三态、返回流程、下载鉴权、私有存储、不可变发布、回滚、隐私与验证边界均已落到任务。五项 Review Focus 分别有任务中的具体断言。当前执行证据记录在验收文档与本任务 ledger；尚未创建云资源、推送、运行远端 CI 或部署。
