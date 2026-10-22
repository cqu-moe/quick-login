# 2026-10-22 0.5.1 蓝色品牌与首页交互候选

- 可执行源码 `4bcb99afdad9bc72cdd19ff7e49e128a91bef474`；官网与插件接入 theme 1.2.0，19 份官方品牌素材核验通过。保留协议 v3、设备授权、Cookie 所有权和现有权限，Auth 源码与 Worker 未改。
- 本地候选 `cqu-quicklogin-0.5.1-canary.zip`：152054 bytes，SHA-256 `0029540913aadf1a5d0e380656ffe884beb6186e891364b7851c12ff307c693c`。ZIP CRC、14 个运行文件、manifest 0.5.1、build-info 来源与 dist 字节比对通过。该包未启用诊断 token，正式包需按合并提交重新构建，不复用此摘要。
- 扩展/官网类型检查、应用测试、发布工具测试、扩展构建/包检查、官网构建/7 页资源检查通过；首页 12 组视口/主题、鼠标/触摸/Space/Tab 与减少动态效果检查通过。候选未做真实大学 SSO 验收。
- 用户已授权 PR、CI 通过后合并上线与生产复验。PR CI、官网自动构建、正式 Canary 和商店 CD 状态待发布后独立记录；当前不将本地验证称为上线或商店上架。

---

# 2026-10-21 0.5.0 官网 Canary 正式发布；商店等待既有审核

- [PR #32](https://github.com/cqu-moe/quick-login/pull/32) 全部 7 项检查通过后 squash 合并；源码及标签 `v0.5.0` 为 `0b6ba77e54555558bb2b8251dd2fc1682d9530cb`。本次仍为协议 v3，Auth 源码/Worker、权限和数据申报不变。
- PR 的[常规检查](https://github.com/cqu-moe/quick-login/actions/runs/39462177720)及[四组两轮真实 MV3 E2E](https://github.com/cqu-moe/quick-login/actions/runs/39462178071)通过。首轮 CI 的移动端设备组在第二轮最后一个场景、扩展连接前，隔离学校绑定返回 `BROWSER_DEADLINE`；账号数量 0、无扩展 Auth 请求，容器/proxy/镜像清理通过。失败证据 artifact `12284465557` 保留；仅受控重跑失败组及汇总一次，两轮业务、原生 alarm/ACK 负向控制和证据准入全部通过，没有改代码或放宽断言。
- [主分支常规检查 39468618529](https://github.com/cqu-moe/quick-login/actions/runs/39468618529)与[Canary 发布 39468618619](https://github.com/cqu-moe/quick-login/actions/runs/39468618619)成功。正式包 `cqu-quicklogin-0.5.0-canary.zip`：152024 bytes，SHA-256 `59df7e4469f389239349ff471a4d5b2e782cf21abea50f536d37ba1e812e0b8f`。R2 包、不可变记录及渠道读回通过，不能套用下方本地候选摘要。
- 现有 Auth 浏览器会话实际下载 200 ZIP，匿名下载 401；公开元数据为 0.5.0、上述大小及 SHA。实际 ZIP 与主分支 CI archive 逐字节相同，14 个运行文件、CRC、manifest 0.5.0、build-info 源码/协议/契约和逐文件内容全部核验通过。CI runner 的公开请求被 Cloudflare challenge 拦截，已补这层真实浏览器验收。
- 官网生产[构建 195bbf4d-f0d5-49c6-8994-7ba7dc4e5002](https://dash.cloudflare.com/a666c560407022706a52a703923548d5/workers/services/view/quick-login-website/production/builds/195bbf4d-f0d5-49c6-8994-7ba7dc4e5002)成功；Worker 版本 `ed62fc94-e34d-43b5-bee8-5aa34ff0eb2c` 为 100% 流量。下载页显示 0.5.0；实际加载的公开脚本读回 `0.5.0+0b6ba77e54555558bb2b8251dd2fc1682d9530cb`，与 CI 官网脚本逐字节一致。
- [商店 CD 39468811125](https://github.com/cqu-moe/quick-login/actions/runs/39468811125)成功完成候选准备、签名验证和 Google 状态查询，实际返回 `WAITING_REVIEW`、`reviewVersions: ["0.4.9"]`。**0.5.0 尚未上传、送审或上架**；保持已有 0.4.9 审核、Unlisted 和最新候选，不撤审、不并行上传。准备的商店 ZIP 为 151654 bytes，SHA-256 `14047d877ddc30f12db8fbd506ec7173adbcb30b685f4707be2e6b6dfe1a846e`；签名 CRX 为 154069 bytes，SHA-256 `49848c938083a6b21c8676fd80ee1c94219aeb2ce9d59bf06fcae2557a61ed38`，这些是已准备文件的摘要，不能称为已上传回执。
- [主分支原生 E2E 39468618618](https://github.com/cqu-moe/quick-login/actions/runs/39468618618)已在发布提交上全部通过：四组各两轮独立业务、原生 alarm/ACK 负向控制、证据准入及最终汇总成功。本次发布不等于已安装扩展自动升级或真实大学 SSO 验收。浏览器安全策略禁止扩展管理页访问，未绕过。主目录 fast-forward 因未跟踪的 `posthog-audit-report.md` 会被覆盖而中止，原文件保持不动；发布和证据记录在独立工作树完成。

---

# 2026-10-21 0.5.0 商店自动更新候选

- 候选源码 `619e8d1f41f585ca885a9091261f157cec67908e`，分支 `codex/extension-auto-update`。Chrome 负责商店检查及下载；下载就绪后等待授权、后台同步、Cookie 写入和 ACK 完成，再自动重载应用。服务端要求升级时自动检查，持久化升级状态在 worker 重启后也会检查；现有更新按钮返回结果，连续检查合并并使用 session 冷却。
- 本地候选 `releases/cqu-quicklogin-0.5.0-canary.zip`：151270 bytes，SHA-256 `232b93b5c0006cd8b84166548677150d58238b17905289879ca76eaef45cf0cf`。14 个运行文件、CRC、manifest 0.5.0、build-info 源码/协议/契约及 dist 逐文件字节核对通过。此包为未启用诊断 token 的本地候选，正式发布包应由合并提交重新构建，不能套用此摘要。
- 203 项应用测试、30 项发布工具测试、扩展/官网/E2E 类型检查、扩展及官网构建/包与页面检查通过。原先缺失的下载就绪应用和升级检查测试先红后绿；真实 Cookie 写入并挂起 ACK 时不提前重载、OAuth 完成/取消后再更新、worker 重启、检查并发与限频均有回归。规范与需求两轴审查完成；持久化升级状态漏检已修复。
- 2026-10-21 公开商店页实际读回 0.4.9、更新日期 2026-10-20。本机 Chrome 磁盘中此商店 ID 的 manifest 为 0.4.6，update_url 为 Google 官方地址；这不能证明运行中的已加载版本或停留原因。浏览器工具安全策略拒绝访问 `chrome://extensions`，未通过其他途径绕过；真实商店更新及学校 SSO 仍未验收。
- 本候选尚未合并 main、晋级官网 Canary、上传商店或送审。旧版获得新逻辑前仍依赖 Chrome 原生更新机制。Auth 源码和 Worker 未改动，扩展权限及数据申报不变。

---

# 2026-10-20 0.4.9 商店自动 CD 已启用并送审

- [PR #30](https://github.com/cqu-moe/quick-login/pull/30) 合入自动 CD；[PR #31](https://github.com/cqu-moe/quick-login/pull/31) 修复 Chrome CRX 合法目录条目校验。发布工具提交 `d3643ced9f1be2935d631a6a2924ce55582919b3`，扩展仍使用已发布 Canary 的源码 `8a42236dad09566255d165142a3b361e9c0676fd`，未重新构建运行代码。
- [首次成功运行 39443868183](https://github.com/cqu-moe/quick-login/actions/runs/39443868183)：R2 包和不可变元数据校验、RSA CRX3 签名及逐文件比对、Google OIDC、真实上传、`DEFAULT_PUBLISH` 送审均成功；2026-10-20 22:57（Asia/Shanghai）API 回读 0.4.9 `PENDING_REVIEW`。获批后自动发布，不把送审当作已上架。未修改既有 Unlisted 分发设置。
- 本次实际上传 `cqu-quicklogin-0.4.9-webstore.crx`：153440 bytes，SHA-256 `387e800f47c321baeff57a58e97345502ec73c9ff19e1025aa65c4f4d458eefa`。准备 ZIP：151052 bytes，SHA-256 `882a77516ec43926eb01069d3e320b7774e9241bbfb32d5803a49d8b4732cc90`。这些摘要来自上传前验证；Google API 不提供远端包摘要。
- [重复检查 39444049036](https://github.com/cqu-moe/quick-login/actions/runs/39444049036) 成功，22:58 仍回读 `PENDING_REVIEW`，已有版本分支未上传或再次送审。重复签名的本地 CRX 可能因 Chrome ZIP 时间戳而有不同摘要，不代表商店包被替换。
- `webstore.yml` 已启用：Canary 成功后检查，另在每小时第 17、47 分钟检查；审核中保留最新 R2 候选，拒审/政策告警停止变更。Google 身份联合、商店服务账号、用户自行配置的 Verified CRX Uploads 及签名 Secret 均已通过真实流程。
- 验证边界：PR #30 四组两轮 MV3 E2E 全部通过；目录修复的 CI 通过 186 项单测、30 项发布测试和构建检查，真实完整本地包签名也通过。该打包工具小修复未重新等待完整 E2E；扩展运行代码未变。首次失败运行 39443083971 在签名目录校验处停止，未调用 Google API；真实大学 SSO、商店获批和商店安装后的业务行为仍未验收。Auth 代码与 Worker 未修改。浏览器任务页在最终核对前已关闭，送审结果使用 Google API 回读证据。
- 配置、暂停与恢复见 [商店 CD 运维](quicklogin-webstore-cd.md)。

---

# 2026-10-16 QUICKLOGIN-02 / 0.4.8 本地验证完成，未发布

- 可执行源码 `e1fde7ddf48c48fb3bc06250aadd568be46e1c93`；实际固定 Auth `870933794326b9d280dcf07f392c80c127fd7233`。两轮全新真实扩展/内部 Auth/原生容器/学校替身业务各16/16；40业务容器、40proxy、20镜像已独立确认消失。合成学校通过不代表真实大学登录通过。
- 本地候选 `.e2e/local-candidates/QUICKLOGIN-02-e1fde7d/cqu-quicklogin-0.4.8-canary.zip`：142522字节，14文件/CRC/manifest与源码/逐文件字节核对通过，SHA256 `62602b9765a78fe5dbf55a392bad1111b0a5186b4dbeb7d8c5956b3f336a6194`。旧候选未覆盖。
- 171项单测、10项发布测试、类型与构建/包检查及失败控制通过；既往transport500首败与尚未确定的原因如实保留。详见 [QUICKLOGIN-02报告](../e2e/results/QUICKLOGIN-02.md)。
- 本票未合入integration/main、未push、未创建标签、未部署Worker/官网、未上传或晋级canary、未操作商店。Auth仅作本地固定依赖，生产Worker版本不适用。父任务负责独立审查与integration推送。

---

# QuickLogin 发布操作与历史记录

发布规则见 [发布约定](../agents/release.md)。以下按历次工作追加，顶部不是最新状态；按版本标题查找证据，历史“待部署”等措辞只适用于对应记录。当前源码版本查 package.json，线上版本需实际读回。

# 2026-10-14 0.4.6 遥测 v2 与商店送审

- 扩展 PR #17 合并、标签 `v0.4.6`，源码 `1f9130b9438715c230294bff08b25665b88f32a2`。CI 与 canary 发布成功。
- 真实 Auth 受控下载取得 `cqu-quicklogin-0.4.6-canary.zip`：141876 bytes，SHA-256 `62b45dcb09d1275ab0cd2c074dbb86fcdd3d2af2d6f13baaf7be4e0da8e46681`。CRC、14文件、版本、build-info 与源码一致。
- 商店包 `cqu-quicklogin-0.4.6-webstore.zip`：141509 bytes，SHA-256 `5795c1fd66537b407e52f78517bf27803fb31c4f012c5493d8664b0e2448278f`。13个运行文件与实际 canary 逐字节相同，manifest 只删除 canary 公钥。
- 用户明确授权上传、提交审核、通过后自动发布。Google 后台读回草稿0.4.6、状态待审核；确认勾选自动发布。当前已发布0.4.4，不把送审当作0.4.6已上架。保持Unlisted和既有权限。
- 商店说明同步中央内部账号标识/未连接独立安装标识、结果/耗时/有限错误分类，不上传 Cookie、账号凭据、输入内容。扩展无录制；自己的官网100%范围受控遮蔽录制，新PostHog项目662666，GeoIP关闭。
- Auth配套生产提交 `6aa18abfa01f8c128724ed7ddd95986cb3ec064e`，Worker `b8b25624-c507-4731-a9d1-c88f931f6e20`；RELEASE/QUICKLOGIN_SERVER_BUILD均实际读回匹配。官网Worker `6419558e-94bf-4189-a023-7cbecd5bb313`，页面下载链接实际显示0.4.6。
- 待完成：0.4.6商店审核与安装渠道升级、真实扩展遥测接收验收。学校目标站登录仍记未验证，不额外请求学校接口只为遥测。旧PostHog608620在全量迁移验收前保留。


# 2026-10-10 0.4.3 商店送审与官网 canary

- 扩展 [PR #11](https://github.com/cqu-moe/quick-login/pull/11) 已 squash 合并；源码 / `v0.4.3`：`ec565f422cb81cdf29e8efc0e1f84de44f46548f`。
- 正式官网包：`cqu-quicklogin-0.4.3-canary.zip`，127149 bytes；SHA-256：`010839a52d837002fdfd15afb2d4e4b60b4498244f5f2a2999a7e37f30f5b36e`。
- [Publish canary 38023555881](https://github.com/cqu-moe/quick-login/actions/runs/38023555881) 成功；实际 Auth 浏览器读回 0.4.3 元数据并受控下载 200。下载 ZIP 的 SHA、CRC、12 个 dist 文件、manifest 版本和 build-info 源码均匹配；早期本地候选 archive 未覆盖。
- 商店最终包：`cqu-quicklogin-0.4.3-webstore.zip`，126779 bytes；SHA-256：`991b8ab6100ec0b643c6c8ccbafa9850c089294b11b96cd3c2d9d7a803b27342`。从上述正式 canary 内容生成，仅删除 manifest 的 canary 公钥字段，其他运行文件逐字节一致。Google 草稿 CRX 回读也确认同一 sourceCommit 与运行文件；原始 canary ID 保留。
- 官网生产 Worker：`bba72ea7-5434-4666-95ed-5e5bf58d6faa`，100% 流量。隐私页浏览器读回 2026 年 10 月 10 日、支持邮箱和 Cloudflare/PostHog、保存与删除说明。
- Auth [PR #53](https://github.com/cqu-moe/auth/pull/53) 全绿后 squash 合并：`8e24696a364b627a9432c06719892a29350fbb57`；自动 [Workers Build](https://dash.cloudflare.com/a666c560407022706a52a703923548d5/workers/services/view/cqu-moe-auth/production/builds/39c6e4f0-2fb5-4d50-ab4f-a7f4b9d8abe9) 成功，生产版本 `5c7d560d-271f-4047-b42b-5d3507c46e51`，100% 流量。保留 public client/PKCE/scopes，登记两个精确回调；store 与 canary Origin 共存，不使用通配扩展来源。
- 同一生产 Worker 的 workers.dev 协议验收：两个精确 Origin 的 registrations OPTIONS 204 / 匿名 POST 401 均精确回显 ACAO；伪造后缀来源 403、无 ACAO。无效 token grant 返回 400 invalid_grant，并只给接受的 Origin 精确 ACAO；无凭据 CORS。自定义域 CLI 被 Cloudflare challenge 拦截，不能算接口结果。
- 真实 Ego canary 页读 capabilities 200；浏览器协议层临时 Origin 复核自定义域对 canary/store 回显精确 ACAO，伪造来源的公开能力接口不回显 ACAO（公开响应仍为 200），临时请求头已清除。协议测试不等于商店签名安装验收。
- 修复安全退出普通用户模拟会话：仅 stop-impersonating 交给原生 signed admin-session Cookie / impersonatedBy / 原管理员会话归属校验，其余管理接口继续强认证。实际浏览器退出预览 200，恢复原管理员会话。
- 扩展：typecheck、124 tests、build、12-file package check、8 release-script tests、官网 typecheck/build/check 全部通过；Auth：892 单元、387 Workers/DO、两套 typecheck、API 生成/检查、边界与 lint 通过。两个仓库独立审核无阻塞发现，PR CI 全绿。
- Ego 原 canary 加载目录已先备份再覆盖正式 0.4.3 并 reload，保留设备与浏览器存储；实际弹窗正常显示“需要重新连接 Auth”。未操作无关 HTTPS 验收扩展，未重新授权用户设备或宣称学校 SSO 成功。
- Chrome Web Store 条目：`ainapeknaclcpoioimonkodmoakhacjd`，公钥推导 ID 已核对。免费、Unlisted（不公开），保留所有地区。图标、真实恢复截图、RGB 宣传图、权限/隐私申报与测试说明均已提交。
- Google 于 2026-10-10 显示“已将您的扩展程序提交送审”；选择审核通过后自动发布。当前未获批、未上架；[查看审核状态](https://chrome.google.com/webstore/devconsole/49da818d-a01c-4995-a0cd-f0f3f2535c71/ainapeknaclcpoioimonkodmoakhacjd/edit/status)。
- 专用普通 Auth 审核账号已验证密码登录，额度 2 台、无管理权限、无学校绑定；凭据已在 Google 保密测试字段持久读回，仅保留于该后台。审核说明明确完整学校 SSO 需要审核员自己的合法重庆大学账号；本次未提供学校测试账号，也未验证商店签名安装或真实学校业务登录。

---

# 0.4.1 已发布（2026-10-09）

- 发布源码/标签：`e36312d3a314e405409ac06dba2ff8fd4286a175` / `v0.4.1`。
- 官网包：`cqu-quicklogin-0.4.1-canary.zip`，122473 字节。
- SHA-256：`9839ffd6f01125af45dc2f9256e929749b5b96dbb8e1d5e480d04517d5a46a02`。
- Publish canary 运行 `37921956246` 完成不可变包上传、R2 回读及 canary 从 0.4.0 晋级 0.4.1。随后公开接口 curl 验收被 Cloudflare challenge 拦截；已用真实浏览器读回 0.4.1 与相同 SHA-256。
- 官网 changelog 已显示 0.4.1/0.4.0；后续由版本说明生成。CI 对明确的 Cloudflare challenge 记录浏览器验收待办，普通 HTTP 错误和元数据不一致仍失败。Chrome Web Store 未发布。

# 版本自动发布与更新记录（2026-10-09）

main 当前版本尚无标签时，Publish canary 工作流在完整校验后创建 vX.Y.Z 标签、发布不可覆盖的 ZIP/元数据并推进 canary 下载渠道。已有标签的普通 main 提交不重复发布；失败可重跑原工作流，或对已有标签手动 dispatch 重试。

每次更新统一 package.json、package-lock.json、public/manifest.json 的版本，并添加 docs/releases/X.Y.Z.md（Date: YYYY-MM-DD 和面向用户的条目）。官网构建自动从这些文件生成 changelog 和 RSS，缺失当前版本说明会阻止构建。官网仍由 Cloudflare Git Connector 部署。

0.4.1 说明已补齐，本次发布不更改插件行为或扩展 ID。发布提交、ZIP SHA-256 和渠道读回结果以 Publish canary 工作流的 release evidence 为准；Auth 配套为已合并提交 ac8346f675f8f065759610d6609ba54e7839dcb9，生产 Worker 404705d6-8b47-42d4-91bb-b0bfb7079028。Chrome Web Store 未发布。

---

# 官网改用 Cloudflare Git 集成（2026-09-28）

生产 Worker 使用控制台实际创建的 `quick-login-website`，域名仍为 `quicklogin.cqu.moe`。官网由 Cloudflare Workers Builds 连接 `cqu-moe/quick-login` 的 main 自动构建部署；移除 GitHub 的官网部署工作流，不再要求 quicklogin-website 环境中的部署 Token。

- 根目录：仓库根目录。
- 构建命令：`npm run typecheck:website && npm run build:website && npm run check:website`。
- 部署命令：`npm run deploy:website`。
- 新版 Worker Previews 的预览命令保留 `npx wrangler preview`；仓库根目录 `wrangler.jsonc` 含空 `previews` 区块，静态资源固定为 `website/dist`。
- 插件 ZIP 仍由 GitHub 的 vX.Y.Z 标签流水线发到私有 R2，quicklogin-release 环境及其凭据继续使用。

控制台 build 72d3f313 失败原因：官网 PR 尚未合入 main，所克隆旧代码没有 typecheck:website 脚本。构建命令本身无需改成扩展构建命令。

## 之前的配置记录

# QuickLogin 0.4.0 官网与受控下载（本地完成，未上线）

- 官网及 CI 代码提交：`27f20484146a45f09238ebe055202e6ba05f670e`；分支 `codex/quicklogin-website`，尚未推送或合入 main。
- Auth 提交：`08593b35159d4822904471131e6a477f4884c389`；尚未推送或部署，本次 Worker version 不适用。
- 本地候选包：`releases/cqu-quicklogin-0.4.0-canary.zip`，122318 字节；扩展源码 `c29f7ec84416bdce610d4c0e9b15fbbea14d7c42`。
- SHA-256：`c017d12fec904768b2bfc4e6a80fbb6fc034f9436e46bed9f0095f6d7151d474`；ZIP CRC、8 个文件、manifest 与 build-info 均已核验。
- 已通过 94 项插件/官网、8 项发布脚本、858 项 Auth 单元及 317 项集成测试；复核提出的窄屏与不同版本字节验证已修正。
- CI 已实现标签发包、私有 R2 条件写入与校验后切换版本；当前仓库尚无 CI secrets/environments，R2 目标桶尚未建立，不能声称自动发布已启用。
- [完整验收与首次上线清单](../acceptance/quicklogin-website.md)。未操作用户 Chrome，未上传 Chrome Web Store。

## 此前记录

# 官网与 0.4.0 发布初始化（待部署）

1. 在目标 Cloudflare 账户创建或核对私有桶 `cqu-quicklogin-releases`，确认 r2.dev 和自定义公开域名均关闭。
2. Auth 的 `QUICKLOGIN_RELEASES` binding 指向此桶；先部署并验证 Auth 新接口，公开 `/release` 在尚无包时应返回 503。
3. QuickLogin 仓库配置 `quicklogin-release` 环境：secrets `R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`CLOUDFLARE_ACCOUNT_ID`，变量 `R2_BUCKET=cqu-quicklogin-releases`。R2 token 只授权该桶对象读写。限制环境为受信任版本标签及 main 回滚，不把密钥复制进源码。
4. 配置 `quicklogin-website` 环境：secrets `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`。令牌仅授予官网 Worker 部署及所需域名操作权限。
5. 官网 main 变更通过门禁后部署；插件须明确推送 `v0.4.0` 标签才发布。每次发布先在源码中统一版本，添加 `docs/releases/X.Y.Z.md`，将提交合入 main 后再推送同名标签。
6. `Publish canary` 自动校验、打包、上传、读回并提升版本，Workflow Summary 和私有 R2 release.json 记录来源及摘要。按这份证据更新运维文档，不让流水线自行改 main 或 Git 身份。
7. `Roll back canary` 仅从 main 手动指定已发布版本运行，与发布共享并发组；它不删除或覆盖历史包。

首次上线尚未执行。网站本地合成预览不代表生产身份校验或真实下载验收。受保护环境、密钥与资源必须先核对；没有配置时工作流应失败而不是公开包。

# 私有 R2 发布脚本（尚未上线）

发布使用 AWS CLI 1.42.49；S3 凭据从 `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` 读取。构建后的版本记录路径为 `releases/X.Y.Z.json`。

- 发布：`python3 scripts/release.py publish --record releases/X.Y.Z.json --bucket <目标私有桶> --endpoint https://<账户ID>.r2.cloudflarestorage.com`
- 回滚：`python3 scripts/release.py rollback --version X.Y.Z --bucket <目标私有桶> --endpoint https://<账户ID>.r2.cloudflarestorage.com`
- ZIP 与版本记录只允许条件创建；重复执行必须内容相同。读取远端 ZIP 核验摘要和内嵌 provenance 后，才按 ETag 条件更新当前指针。
- CLI 失败、权限不足不能被当作对象不存在；旧任务不能自动降级。回滚也要验证目标包。
- 每个 ZIP 写入 `sha256` 自定义元数据，Auth 按记录、对象大小及此摘要核验后流式下载。

当前仅通过本地合成存储与真实 CLI 参数校验，未上传生产 R2。

# 官网安装包构建（实现中）

使用 `python3 scripts/release.py build --tag vX.Y.Z --notes docs/releases/X.Y.Z.md --output releases`，先执行现有 package 门禁，再验证标签、源码与构建版本及 HEAD。ZIP 仅含 dist 内容，顺序、时间和权限固定；已有不同版本文件拒绝覆盖。记录输出为 `releases/X.Y.Z.json`。当前未上传 R2 或部署。

# QuickLogin 0.3.4 授权恢复与开关修复（2026-09-28）

- 扩展源码提交：`62c79f9aedac5a4da632b0bb6c83fae507a35a92`（隔离分支 `codex/quicklogin-auth-recovery`，未推送或合入 main）。
- 安装包：`releases/cqu-quicklogin-0.3.4-canary.zip`，122678 字节，仅含 8 个 dist 文件。
- SHA-256：`993204a2c3ea4daf888b1a07ac3132f8f3ff96198bc9eef64914afd4e5c0877b`。ZIP CRC、文件清单、逐文件内容、manifest 版本与 build-info 源码提交均已核验。
- 根因：Auth QuickLogin refresh 校验钩子使用 `code: INVALID_GRANT`，扩展仅识别 OAuth 标准的 `error: invalid_grant`，误报网络故障。现兼容两种格式，提示前往 Auth 恢复原设备，停止重复刷新失效授权。
- 本地关闭而服务端快照仍开启时，`canEnable=false` 不再锁死重新开启；确实无法开启时保留 Auth 入口。禁用开关不再显示等待鼠标。
- 验证：19 个测试文件 / 88 项测试、typecheck、build、check:package 通过；新增回归在修复前失败，修复后通过，包含真实外部消息到 OAuth、原设备注册、重新开启与同步（仅浏览器 API/HTTP 使用合成数据）。独立代码复核通过。
- 测试存在上游 posthog-js source map 警告，基线亦存在，不影响通过结果。
- Auth 代码未修改或部署。未操作用户 Chrome、未覆盖已加载目录、未重载扩展、未上传或发布 Chrome Web Store。实际浏览器重连与学校登录仍待升级后验证。
- 使用方式：解压并覆盖原加载目录，在 Chrome 扩展管理页重载，随后在弹窗点“前往 Auth”恢复原设备授权；不要卸载重装。
- 本次合成 token 在线格式探测被 Cloudflare 403 挑战拦截；错误格式依据 Auth 源码确认，未声称完成线上授权验收，也未确定用户 token 最初失效的具体原因。

## 历史记录

# QuickLogin 0.2.5 弹窗稳定性修复（2026-09-15）

- 源码 `486b334af778a1bf4f09e7e84d4e37e4cc37e426`；安装包 `releases/cqu-quicklogin-0.2.5-canary.zip`，23290 字节，8 个 dist 文件。
- SHA-256 `db56cb0dc3e88809a65e0a8ad129e3aea2f567a1ddb31907aebca55fa3fdca81`；manifest、源码标识、ZIP CRC 均通过核验，旧包保留。
- 例行 Cookie 续验保留已确认回执状态，不再每次标为 pendingAck；首次同步仍等待 ACK，服务端拒绝匹配回执时清空并重新导出。状态区不再重复淡入或上下移动。
- 81 项测试、typecheck、build、check:package 和独立复核通过。回归在旧实现中复现轮询把 ready 变为 pending_ack；修复后保持 ready，并覆盖首次 pending 和拒绝回执恢复。
- Auth 本次未改动、未部署；协议和存储格式不变。用户 Chrome 未操作，覆盖原目录并重载后生效；原生弹窗视觉验收待该安装更新。未上传 Chrome Web Store。

## 历史记录

# QuickLogin 0.2.4 切换授权修复（2026-09-15）

- 插件源码：`3fbc350e64a9ed6fc8ddbd1a6d363967da880b4e`。
- 最终包：`releases/cqu-quicklogin-0.2.4-canary.zip`，23293 字节，仅含 8 个 dist 文件。
- SHA-256：`30182b9775189890f0e88ed9e0d980c7f16f6e9ddc53cd1f4b41b3ef8fbf5fce`。
- 协议仍为 3，指纹 `0263d6f205e113cdc2da8661f2fdf8c7e5b52b5a41045b90633d8d5989625a38`；本地 schema 2 增加可选切换记录，旧安装不需要重建身份。
- Auth 本次无改动、无再次部署；线上源码读回仍为 `cb4389300e261996551ffac79450c2f66277af5d`。

“已有学校登录”是本地 Cookie 归属保护，不代表账号异常。已复现旧的一次覆盖授权在云端 sessionVersion 更新时失效，以及等待下一轮同步时丢失。现将切换记录保存 15 分钟，绑定设备、授权、学校绑定及用户操作版本；同一绑定的会话更新可以继续。关闭开关、手动模式、改绑、重新授权或到期会取消；写入成功时与 Cookie 所有权记录一起原子消耗，后台重启不会重复使用。

78 项测试、类型检查、构建、包检查和独立复核通过。回归覆盖先失败后通过、跨等待与后台模块重启、取消边界、真实 Cookie writer 的一次消耗，以及后来手动登录不被再次覆盖。ZIP CRC、版本及源码标识已核验。

本次只读线上检查时，两台既有 0.2.3 设备均 cloud ready / Cookie applied / ACK 成功；这是服务端事实，不能据此认定用户原生弹窗切换流程通过。0.2.4 尚待用户覆盖原目录并重载验证，未操作用户 Chrome、未修改学校 Cookie；未上传 Chrome Web Store。

## 历史记录

# QuickLogin 0.2.3 Cookie 导出与任务恢复修复（2026-09-15）

- 插件源码：`683081ad9b38b43219d024916b9a4f193f040efc`。
- Auth 源码：`cb4389300e261996551ffac79450c2f66277af5d`。
- [生产 CI](https://github.com/cqu-moe/auth/actions/runs/34976675384)：成功。
- Worker：`22014c4d-c283-4f5f-b12d-557ec2d4ee74`，100% 流量。Container 68 / `22014c4d`，5 healthy、0 failed，无活动 rollout 或 health.errors。
- 安装包：`releases/cqu-quicklogin-0.2.3-canary.zip`，23022 字节，8 个 dist 文件。
- SHA-256：`046cfbb810f7379a366f5a6b882374f46230f7758eba1bb00227e909af021770`。
- 契约指纹：`0263d6f205e113cdc2da8661f2fdf8c7e5b52b5a41045b90633d8d5989625a38`，协议仍为 3。
- ZIP CRC、manifest 0.2.3 和源码标识已核验。旧包均保留；未上传或发布 Chrome Web Store。

容器现在导出完整会话 Cookie；Auth 对登录结果处理异常及时结束任务，并恢复符合条件但缺失的调度。插件补齐 queued 且无 operationId 时的 ensure_session 请求；已有任务、未来冷却时间或 canEnsure=false 均不会触发。已安装的 0.2.1 使用同一 Cookie 服务修复，但无任务恢复需要更新至 0.2.3。无需卸载或新建设备。

本地验证：Auth 850 单元测试、284 DO 测试、两套类型检查；Container 368 测试及 13 subtests；插件 69 测试、typecheck、build、check:package 全部通过。生产者与消费者共享 Cookie fixture，独立复核无阻塞发现。

实际读回：22:01，Ego 原设备在新容器上完成登录，cloud=ready、Cookie=applied、ACK 成功；未更换设备身份。用户 Chrome 仍为 0.2.1、queued 且无任务，需更新 0.2.3 并重载后验证客户端恢复分支。尚未证明两台设备均通过实际学校业务页面验收。

详细证据见 [准备登录故障记录](quicklogin-023-preparing-incident.md)。

## 历史发布记录

# QuickLogin 0.2.1 发布与验收（2026-09-15）

## 已交付

- 插件源码：`6a4be4289d380c12b92f27c388cdbe41deab5a4c`，已推送 `quick-login/main`。
- Auth 源码：`0f640b52d78ff9425dd978a238cc1e1fbc390ab8`，已推送 `auth/main`。
- [生产 CI](https://github.com/cqu-moe/auth/actions/runs/34964465904)：成功；检查、迁移、部署均完成。
- Worker：`d6bd0feb-bc91-4dff-b074-e1b57c8e12f5`，100% 流量。
- Container：版本 67，当前镜像标签 `d6bd0feb`，5 healthy / 0 failed，health.errors 为空。
- 健康、capabilities、overview 均 HTTP 200；protocolVersion=3，serverBuild 与上述 Auth 提交一致。
- 安装包：`releases/cqu-quicklogin-0.2.1-canary.zip`，22986 字节，仅含 dist 的 8 个文件。
- SHA-256：`e811fe778471c99f40fdf1cff2d2cbcc5b230d109765f2f82e44003e60cc9258`。
- 契约指纹：`0263d6f205e113cdc2da8661f2fdf8c7e5b52b5a41045b90633d8d5989625a38`。
- ZIP 内容、CRC、manifest 版本和 build-info 源码提交均已核验。旧 0.2.0 包保留，未覆盖。
- Chrome Web Store：未上传、未发布。

## 验证结果及实际边界

| 项目 | 结果 |
| --- | --- |
| 插件 | 65 测试、typecheck、build、check:package 通过 |
| Auth | 849 单元测试、281 DO 测试、两套 typecheck、API/边界检查、API lint、前端 lint/build 通过 |
| Container | 365 个测试通过；13 种实际 raw-CDP 失败格式贯穿生产响应与 Worker 消费测试 |
| 独立审查 | 协议、跨仓库整合及所有具体修正复审通过 |
| 既有 Ego 安装升级 | 实际运行 0.2.1/sourceCommit 与包一致；deviceId、授权及 schema 2 保留，设备数仍为 2 |
| 真实学校自动登录 | **未通过**：交付读回为 `retry_wait / VERIFICATION_COOLDOWN`（等待验证恢复），尚无当前 Cookie 的成功 ACK，不能据此声称已进入学校业务页面 |
| 用户 Chrome | 未控制、未自动重载；需用户从最终包更新原安装目录 |

Ego 的普通扩展标签页不等于原生 action popup；该测试环境无 active browser window，不能用其调试标签页标题证明真实 Chrome 弹窗。此次以实际后台存储、服务器快照和包 provenance 核验升级；UI 有自动化与实际组件预览证据。学校登录成功与 Cookie 回执仍是独立业务门禁。

当前实现已把上游返回的验证码、凭据、人工验证和超时错误分类，并保留正确的等待/人工处理状态；这不等于校方登录已经恢复。后续排查入口见 [运行状态交接](quicklogin-021-runtime-status.md)。

## 安装

已有插件无需卸载：把新包内容解压覆盖原加载目录，然后在扩展管理页点击“重新加载”。根目录应直接包含 manifest.json。不要并行加载另一份副本。

原始主目录 dist 在用户更新前保持旧安装内容，避免运行中的旧后台与新弹窗混用；交付文件以上述版本化 ZIP 为准。

## 本次主要行为

- 共用协议、状态及错误定义；Auth 主学校会话、设备会话、浏览器应用回执分开表达。
- generation/绑定/凭据/会话版本完整校验，网络错误不再冒充未绑定。
- 作业与验证码租约持久化，旧任务、旧保活和旧回执不能覆盖新意图。
- 实际容器错误被规范化；设备 CAPTCHA 不污染其他设备或全局凭据，手动登录先停止自动写入。
- 设备行仅保留名称、一个状态、一行版本/联系信息；退出后果仅在确认时显示。

## 历史发布记录（不代表当前状态）

# QuickLogin 发布门禁

本文只描述发布顺序，不授权部署、生产写入或 Chrome Web Store 上传。所有命令先在测试环境执行；任何一步读回不一致都停止，不继续切换 mode。

## 发布前资料

- 保存脱敏的旧资格与总开关清单，只含用户 ID、旧 access/master 值和更新时间。
- 管理员逐用户确认设备额度映射。`0` 是有效决定；缺项不是 `0`，必须阻止 apply。
- 确认正式扩展 ID、公开 `clientId`、固定 `https://<extension-id>.chromiumapp.org/` 回调和 `chrome-extension://<extension-id>` Origin。
- 备份当前 Worker 配置和 D1 元数据；不导出密码、Cookie、OTP、token 或 ticket URL。

额度映射格式：

```json
{
  "schemaVersion": 1,
  "migrationId": "quicklogin-devices-2026-09-09",
  "users": [
    { "userId": "synthetic-user-a", "deviceLimit": 3 },
    { "userId": "synthetic-user-b", "deviceLimit": 0 }
  ]
}
```

示例用户是合成值，不代表生产决定。

## 固定顺序

1. 部署兼容后端，保持 `QUICKLOGIN_DEVICE_MODE=off`。此时设备 API 返回 `503 TEMPORARY_UNAVAILABLE`，旧网页开关和广路径 ticket 仍读旧策略，设备维护 alarm 会停止。
2. 通过 Better Auth 管理模型登记官方 public OAuth client；核对 `requirePKCE=true`、`skipConsent=false`、`tokenEndpointAuthMethod=none`、授权码与 refresh grant、固定回调、`cqu:quicklogin:device` scope 和 official metadata。相同配置重跑只读回，不新增 client。
3. 运行迁移 dry-run，核对总人数、缺失映射、冲突用户、每位用户旧 master 与新额度。保存 preview hash。
4. 由管理员明确确认完整映射。存在 `missingMapping` 时不得 apply。
5. 使用受控 Auth 内部 runner 调用 `initializeQuickloginPolicy`，逐用户读回；同一 `migrationId` 和输入可重跑，不同输入必须走常规 quota preview/apply。
6. 部署新版 Auth UI 和未打包发布的扩展内测构建，仍保持 mode off，检查旧登录、课表、验证码租约和网站会话。
7. 仅在前述读回一致后把 `QUICKLOGIN_DEVICE_MODE` 切为 `on`。从此账号协调器是授权、额度与总开关唯一权威；DO 读取失败不得回退旧布尔值。
8. 执行 `docs/acceptance/quicklogin.md` 的新旧业务回归。失败则停止商店发布。
9. 经过单独发布批准后才上传 Chrome Web Store 包。不得从本仓库步骤自动上传。

## 回退

把 mode 关闭会停止新设备 API 与云端维护，旧策略重新服务旧 ticket/开关路径。回退不自动撤销学校 Cookie，也不保证清除浏览器本地会话；需要单独说明用户影响。保留已迁移的账号 DO 状态、grant 墓碑和设备记录，不删除或重置；再次开启 mode 后，仍有效的开关和设备可以在下一次心跳恢复维护。

回退是生产配置变更，必须另行获得发布授权。本地测试通过不构成回退或上线授权。

## 当前门禁状态

- canary 额度映射：`PASS`（唯一旧 QuickLogin 用户，显式额度 5，保留旧 master=true；preview 无缺失/冲突）
- canary OAuth client 登记：`PASS`（固定 public clientId、PKCE、精确回调与 Origin 已读回）
- Auth 部署与 mode 切换：`PASS`（Worker 版本 `0eefd288-6ecd-44db-8bd3-88eb7da9f479`，mode=on）
- Chrome Web Store 发布：`NOT RUN`

## 本地候选包

2026-09-15 generation reconciliation 协议 v2 构建为
`releases/cqu-quicklogin-0.1.4-canary.zip`，只包含 `dist/`，对应扩展提交
`974d703`，SHA-256 为
`68946df7d2c230b8c1f233aa900bc5e277f4205224c9402fc3c33e96e4fcb94c`。
配套 Auth 提交为 `b5ebf82`，生产 Worker
`bdbb2023-62a7-439b-861a-22f0863a73d5` 已接管 100%。status 心跳改用
`observedGeneration`：旧观察值仍返回当前状态并更新在线信息，但不会接受旧
`appliedVersion`。refresh/export 继续要求当前 generation。协议 v1 不兼容，使用前必须
更新到扩展 0.1.4；未上传 Chrome Web Store。

2026-09-13 API v1 构建为 `releases/cqu-quicklogin-0.1.3-v1.zip`，只包含
`dist/`，对应扩展提交 `39377c0`，SHA-256 为
`683449397ce213858bd01576a0ca91c422b4d2769e08aa9bb21c92dccd30417a`。
它固定使用 `/api/v1` OAuth/device 路径和稳定 issuer audience；未上传商店。

2026-09-11 canary 构建为 `releases/cqu-quicklogin-0.1.2-canary.zip`，只包含 `dist/`，对应扩展提交 `09e0158`，SHA-256 为 `498d2c45ee7b24b5f4cf37042aa9ed3e4bc4a1cca896df7489180d620e44fa1f`。该文件未上传到商店；它固定使用 canary 扩展 ID。

2026-09-16 PostHog 本地候选构建为
`releases/cqu-quicklogin-0.3.0-canary.zip`，只包含 `dist/`，对应扩展提交
`8bb2cb634729f090af18a118be403abacc2dc7eb`，SHA-256 为
`c55434507cab339d18c0e6e23346810d3a920fd1694f34cf2bef8c0962e9910e`。
ZIP 完整性、manifest 0.3.0、build-info 提交、typecheck、83 tests、build 和
package gate 均通过。该构建从已验证的 PostHog US 项目 `608620` 动态读取公共项目
token，采集 host 为 `https://us.i.posthog.com`。仍需完成 unpacked extension Reload
和真实操作采集验收；未上传 Chrome Web Store。

2026-09-16 修复 0.3.0 扩展 CSP 遗漏 Auth origin，发布本地候选
`releases/cqu-quicklogin-0.3.1-canary.zip`。包对应源码提交
`9631cf176a085b2b9167a48f24ae45e29ee424bd`，SHA-256 为
`0fd1e571c07c4e1bd400dc4e784276b6ebf3ba5e9ae1ac7b4a655cfd865dac92`。
manifest 的 `connect-src` 精确允许扩展自身、Auth API 和 PostHog US ingest；
package gate 会拒绝再次遗漏任一必要 origin。typecheck、83 tests、build、包检查和
ZIP integrity 均通过。仍需在 Chrome 对 unpacked 扩展执行 Reload；未上传商店。

随后发现 PostHog SDK 的 `advanced_disable_feature_flags` 仍会请求
`us-assets.i.posthog.com/array/<token>/config`。0.3.2 改用当前 SDK 的
`advanced_disable_flags=true`，完全关闭扩展不需要的 flags/remote-config 网络路径，
同时不扩大 CSP。候选包 `releases/cqu-quicklogin-0.3.2-canary.zip` 对应提交
`1c7de1a58e364cd8a128cbbc3b77f715e5fd3c01`，SHA-256 为
`b8b16dc4c164dcfbeb0e9ac1ba90476818e3addd86fa6e82ebf8293314ea603a`。
所有自动门禁通过；Chrome unpacked 目录已更新，待 Reload 后实时验收。

## 2026-10-09 0.4.2 同步编号恢复候选

- 扩展源码提交：`caa17f5b9dedd04c5f4d19e298401af2f16e3cfb`
- 本地候选包：`releases/cqu-quicklogin-0.4.2-canary.zip`
- SHA-256：`5f215fbdac3c3169b8c4647eba5cf6cf26ffc5bde644a22426372780b8f5a745`
- 包大小：122976 bytes；仅包含 dist 内容，ZIP 完整性、根目录路径、manifest 0.4.2 和 build-info 提交均已核对。
- 检查：typecheck、21 files / 111 tests、8 release tests、build、check:package，以及网站 typecheck/build/check 全部通过。
- 审查：规范与需求两轴独立审查完成，发现的授权刷新竞争和中断连接卡死均已修复并复核，无剩余发现。
- 修复：单次、经服务端确认的同步编号恢复；失败引导重连；授权与编号原子保存；旧请求隔离；中断授权恢复。详情见 [故障记录](quicklogin-report-epoch-incident.md)。
- Auth 源码未修改，Worker 未部署。
- 官网 canary：待合并主分支后的发布工作流执行。本地包不是线上发布证据；CI 将按合并提交重新构建，其 sourceCommit/SHA-256 以发布工作流产物为准。
- 真实浏览器覆盖升级、学校页面验收：待验证。Chrome Web Store 未上传、未发布。

## 2026-10-09 0.4.2 官网 canary 正式发布

- PR #10 已 squash 合并；发布源码提交：`6c9cdc2d2ae83f9a127e38cd743556a07dbb6064`，版本标签 `v0.4.2`。
- 正式包：`cqu-quicklogin-0.4.2-canary.zip`，122983 bytes。
- 正式 SHA-256：`ecfa184b81466f53ddad72a1c51e5051f98450f04819a6769118af4949624cec`。此值取代本地候选包校验值用于官网下载验收；没有覆盖旧候选档案。
- [发布工作流 37927789633](https://github.com/cqu-moe/quick-login/actions/runs/37927789633) 成功：完整检查、ZIP 验证、R2 安装包与 canary 通道写入和回读均通过。
- 官网生产构建 `ae34aff9-9729-4fdb-a1ae-a84cefa11902` 成功；浏览器访问 [下载页](https://quicklogin.cqu.moe/download/) 已显示 v0.4.2、正式包名与上述 SHA-256。
- 命令行公开 HTTP 验收被 Cloudflare challenge 拦截；官网下载页公开元数据已通过浏览器读回。登录后实际下载、覆盖安装及学校页面验收仍待验证。
- Auth 源码和 Worker 未变更。Chrome Web Store 未上传、未发布。

# 2026-10-13 0.4.4 品牌与暖橙主题候选（本地，未发布）

- 扩展源码：`ca2ca90ed0791146985b99ec38ffc1ca879c70fe`。
- 本地候选包：`releases/cqu-quicklogin-0.4.4-canary.zip`，138767 bytes。
- SHA-256：`bdc1d68ffc3f1896499f2c0dda2015f0818c63e763757a98e9774cc0e1eea813`。
- ZIP 完整性、仅包含 dist、manifest 0.4.4、build-info 提交和逐文件字节比对通过。此 ZIP 保留为本地候选；合并后的正式 canary 由工作流按合并提交重新构建，不覆盖此候选。
- 扩展 typecheck、124 项测试、build、check:package、10 项发布工具测试及官网 typecheck/build/6 页资源检查通过。
- 四种宽度、双主题和暖橙色对比度已核对；弹窗使用构建产物与合成 chrome.runtime 状态，未加载真实扩展后台、未写 Cookie。官网验收阻断生产 API，不代表真实下载流程通过。
- Auth 配套仅为黑白品牌标识接入（源码 `acbd6f8`）；未部署 Worker。
- 官网 canary、官网生产部署、unpacked 扩展升级与真实学校 SSO 均未执行；Chrome Web Store 未上传、未送审。`release.py build` 生成的 publishedAt 字段是候选记录格式，不是线上发布证据。

# 2026-10-13 0.4.5 动效与响应候选（本地，未发布）

- 当前任务独立工作区基于 `767146b`，0.4.5 修改尚未提交；该基线不是候选修改的发布 commit。
- 版本已同步到 package、lockfile 和 manifest，用户说明见 `docs/releases/0.4.5.md`。
- 本地生成 `dist/` 和 `website/dist/` 供验证。尚未创建不可变 canary ZIP，包名待发布为 `cqu-quicklogin-0.4.5-canary.zip`，SHA-256 待正式包生成后记录；不把未提交工作区的 build-info 当作发布源码证据。
- 已复现的问题及合成状态浏览器验收见 `docs/acceptance/2026-10-13-motion-responsiveness.md`。
- 尚未推送、运行远端 CI、部署官网、重载用户已安装扩展或发布商店；Auth 无改动。正式合并发布时仍需按发布约定生成 ZIP、核验 SHA 并读回 canary。

# 2026-10-13 0.4.5 canary 与官网已发布

- [PR #15](https://github.com/cqu-moe/quick-login/pull/15) 在检查全绿后 squash 合并；发布源码与 `v0.4.5` 标签均为 `d4638e8c56b7b1f731336fb285d492ddc93343c7`。
- 正式包：`releases/cqu-quicklogin-0.4.5-canary.zip`，140464 bytes；SHA-256：`9230d2c344659c846501aa87dfcc73c30a938974d86addad378e3ebb8bfd4991`。
- [PR CI](https://github.com/cqu-moe/quick-login/actions/runs/38346063058)、[主分支 CI](https://github.com/cqu-moe/quick-login/actions/runs/38346178701) 和 [Publish canary](https://github.com/cqu-moe/quick-login/actions/runs/38346178672) 全部成功；142 项应用测试、10 项发布测试、类型检查、构建及包/网站检查通过。发布流程完成不可变包上传、R2 回读及 canary 从 0.4.4 晋级 0.4.5。
- 官网 `quick-login-website` [生产构建 d87dadb3-ac60-4d20-9d9a-34f5a7e8ec41](https://dash.cloudflare.com/a666c560407022706a52a703923548d5/workers/services/view/quick-login-website/production/builds/d87dadb3-ac60-4d20-9d9a-34f5a7e8ec41) 成功；真实浏览器已读回下载页版本/文件名/SHA 和 0.4.5 更新记录，线上引用本次 CI 的 `main-DvUMvUf9.js`、`main-CNhbyHtI.css`。
- CI 的公开 HTTP 验收遇到 Cloudflare challenge，已在真实浏览器补验：公开元数据为 0.4.5；携带现有登录会话的下载接口返回 HTTP 200 ZIP，保存后的字节与正式包完全一致，CRC、manifest、build-info 的版本/提交/协议指纹均通过；省略凭据时返回 HTTP 401，未遇到 challenge。浏览器点击下载的自动化事件未捕获到文件，实际字节验证使用同源会话 fetch，不将其表述为点击流程验收。
- 主分支 CI 产物与正式 canary 字节一致，已保存上述不可变本地包及 `releases/0.4.5.json`；未重新构造一个不同的本地候选包。
- 本轮动效/故障回归详见 [验收记录](../acceptance/2026-10-13-motion-responsiveness.md)。真实 Chrome 已安装扩展重载、学校 SSO 尚未验收；Auth 源码与 Worker 未修改。Chrome Web Store 未操作、未上传、未送审。

## 2026-10-15 0.4.7 学校登录恢复候选

- 工作区：`codex/quicklogin-login-recovery-state`，基线 `c410e127f908a11e25608a8c7e5f81d9d00fd8c9`。本次修改尚未提交；此基线不代表修复后的发布提交。
- 学校登录表单即时撤销 ready/usable，后台安全通知与前台 5 秒检查更新进度。本轮新会话写入、读回及 ACK 后才刷新等待文档；再次出现表单停止自动刷新。离开 SSO 或关闭标签页清理该页面轮次，不据此宣称业务登录成功。
- 验证：23 个测试文件、171 项测试通过；typecheck、build、check:package、契约指纹及三处版本一致检查通过。官网 typecheck/build/check 通过；10 项发布脚本测试通过。新增状态通知不开放可信存储、不新增扩展权限。
- 本地构建：`dist/`；目标正式包名 `cqu-quicklogin-0.4.7-canary.zip`。未创建发布 ZIP，SHA-256 待正式发布记录；未提交的本地 build-info 中 sourceCommit 仍是基线，不能作为修复产物的发布来源证明。
- 待发布：提交/PR/CI、合并触发官网 canary 后记录实际提交及包 SHA，再独立验证安装扩展和 `my.cqu.edu.cn`。当前用户安装仍按诊断时 0.4.6 记录，本地通过不等于已升级。
- Auth 源码和 Worker 未改动；未执行商店上传、送审或发布。
- 诊断和回归入口：`docs/research/2026-10-15-ready-status/README.md`。

## 2026-10-15 0.4.7 官网 canary 正式发布

- 修复 [PR #21](https://github.com/cqu-moe/quick-login/pull/21) 在 CI 与官网预览全绿后 squash 合并；源码 / 标签 `v0.4.7`：`1579ec9a6c93c82c82c10b60e3ae850e9f608d26`。
- [PR CI 38670075452](https://github.com/cqu-moe/quick-login/actions/runs/38670075452)、[主分支 CI 38670205068](https://github.com/cqu-moe/quick-login/actions/runs/38670205068)、[Publish canary 38670205046](https://github.com/cqu-moe/quick-login/actions/runs/38670205046) 均成功；R2 包与通道读回确认从 0.4.6 晋级 0.4.7。
- 正式包：`cqu-quicklogin-0.4.7-canary.zip`，143272 bytes；SHA-256：`f4cc5e9471543d69f0489cbe424779d32a3cca9edf920d79b5cd6023d6f2b4ec`。
- 使用现有浏览器登录会话从 Auth 同源下载接口实际取得 HTTP 200 ZIP，字节数/SHA 与发布日志和公开元数据一致；CRC、14 个运行文件、根目录路径、manifest 0.4.7、build-info 来源提交/协议版本/契约指纹全部核对。仓库 `verify_package` 对该实际下载通过。未覆盖旧版本包。
- CI runner 的公开请求被 Cloudflare challenge 拦截，已补浏览器验收：公开元数据为 0.4.7，匿名下载（credentials omit）返回 401，认证下载返回 200。
- 官网生产 [构建 724b083c-d3ef-4d2e-a3d7-34f3badb2b48](https://dash.cloudflare.com/a666c560407022706a52a703923548d5/workers/services/view/quick-login-website/production/builds/724b083c-d3ef-4d2e-a3d7-34f3badb2b48) 成功；真实浏览器读回 [下载页](https://quicklogin.cqu.moe/download/) 的 0.4.7、正式包名及 SHA，更新记录显示本次修复。
- 本地验证：23 个文件 / 171 项测试、10 项发布脚本测试，扩展与官网 typecheck、build、包/页面检查通过。规范与需求审查中的页面生命周期问题已修复。
- 安装扩展升级与 `my.cqu.edu.cn` 真实学校登录验收仍待单独执行；本次发布不会自动更新用户当前安装。Auth 源码和 Worker 未变更，Chrome Web Store 未上传、送审或发布。

## 2026-10-20 0.4.9 PostHog 代理诊断正式发布

- [PR #29](https://github.com/cqu-moe/quick-login/pull/29) 在常规检查、四组两轮 MV3 E2E 和规范/需求审查通过后 squash 合并。源码/标签 `v0.4.9`：`8a42236dad09566255d165142a3b361e9c0676fd`。
- 正式包：`releases/cqu-quicklogin-0.4.9-canary.zip`，151421 bytes；SHA-256：`c38a7d458a86635c65ffab8aa1283a145d0b42d2810fd22424eccd410f62a669`。
- [PR Checks 39366188236](https://github.com/cqu-moe/quick-login/actions/runs/39366188236)、[PR E2E 39366188123](https://github.com/cqu-moe/quick-login/actions/runs/39366188123)、[主分支 Checks 39368261491](https://github.com/cqu-moe/quick-login/actions/runs/39368261491) 和 [Publish canary 39368261478](https://github.com/cqu-moe/quick-login/actions/runs/39368261478) 均成功。合并树与通过 PR E2E 的树完全一致；R2 包与 canary 通道已读回。
- 真实浏览器认证下载 HTTP 200 ZIP，匿名下载 401；实际包与主分支 CI 逐字节一致，SHA、CRC、14 个文件、manifest 0.4.9 和 build-info 来源/协议/契约指纹均通过。未覆盖旧包。
- 官网 [生产构建 27b0b1ce-bc80-47b7-ae97-7da033eabb24](https://dash.cloudflare.com/a666c560407022706a52a703923548d5/workers/services/view/quick-login-website/production/builds/27b0b1ce-bc80-47b7-ae97-7da033eabb24) 成功；部署 `9c84b3b2-11eb-4647-8f80-65072fe9f3b5` 将版本 `54be953c-85ca-4692-a8e8-2cd5aac34e58` 投放到 100%。浏览器下载页显示正式版本/包名/SHA，主模块 `assets/main-tLKDSPjQ.js` 与 CI 官网包的模块名一致。
- PostHog 662666 在 `2026-10-20 12:15:09.138 +08:00` 收到官网 `$pageview`：release=`0.4.9+8a42236dad09566255d165142a3b361e9c0676fd`，SDK=`1.438.12`，`$lib_custom_api_host=https://p.cqu.moe`，`is_test=true`、`$geoip_disable=true`、`$process_person_profile=false`。查询入库有数分钟延迟。
- 代理健康问题 `01a13ede-c153-7488-91d1-52456f34684c` 仍 active，等每日重新计算，未手动关闭。[审计 notebook](https://us.posthog.com/project/662666/notebooks/dHB8mFAz) 保留历史报告并记录修复复核。
- 本地 186 项应用测试、10 项发布测试、两套 typecheck/build、包和官网检查均通过。已安装扩展重载与真实学校 SSO 未验收；Auth 源码/Worker 和 Chrome Web Store 未操作。
