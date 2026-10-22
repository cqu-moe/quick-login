# 2026-10-22 0.5.3 UX 配套发布候选

- 本次修复首次登录状态、有效开关、异步恢复、学校页面动作、异常提示，以及 Auth 渠道重连和授权指引。完整修复前后证据见 [UX 验收](../research/2026-10-22-ux-audit/FIX-VERIFICATION.md)。
- 已移植到 QuickLogin `1e60dfb` 与 Auth `12d5abe` 主分支；保留 0.5.2 的原生弹窗尺寸修复及 Auth friends scope。Auth 固定测试提交为 `41147c934c577f6a10f5bf3d9cb71597c362a07f`。
- 目标包 `cqu-quicklogin-0.5.3-canary.zip`；发布源码、正式 SHA-256、Auth Worker 版本和线上浏览器证据在合并发布后记录。本地历史候选及 0.5.1 审计构建不代表本次正式包。
- 用户已授权两仓库 PR、CI 通过后合并、Auth 配套部署、官网 Canary 发布和上线 UX 验收。沿用现有自动商店 CD，不手动撤审或修改商品详情；Canary、商店送审与上架分别记录。

---

# 2026-10-22 0.5.2 已发布 Canary，三项蓝色素材已送审

0.5.1 的视口相对宽度令真实工具栏弹窗塌缩到 190px，现恢复原有 390×468；浅深主题原生弹窗回归已先失败后通过，门禁接入 CI。生产样式只改宽度，官网展示不得反向改动扩展布局和控件。验证见 [验收记录](../acceptance/2026-10-22-popup-width.md)。

[PR #35](https://github.com/cqu-moe/quick-login/pull/35) 的 7 项检查全绿后已合并，发布源码及 `v0.5.2`：`543e85cc7684c8f1eea55fb0a59c899fa3babe33`。正式包 `cqu-quicklogin-0.5.2-canary.zip`，152810 bytes，SHA-256 `6f43a6f4f63c7061e7cb06de7536bba27ceaf4b132dddf18e35434c2d3381ddc`。认证实际下载 200、匿名 401、CRC/14 文件/manifest/build-info 与 CI 字节比对通过；正式下载包的原生浅深主题再次通过 390×468 检查。官网生产构建及实际加载脚本也与合并提交、CI 对齐。

[蓝色图标、屏幕截图、小型宣传图](../../store-assets/README.md)已在商品详情中替换、保存并刷新确认。[商店 CD](https://github.com/cqu-moe/quick-login/actions/runs/39766956536)于 2026-10-22 18:57:53（Asia/Shanghai）读回 0.5.2 `PENDING_REVIEW`；后台显示待审核，保持 Unlisted 和审核通过后自动发布。自动工作流已恢复 active。截图明确为界面预览；学校 SSO、已安装商店版升级与商店获批尚未验收。详情和合并后 E2E 结果见[发布记录](quicklogin-release.md)。

---

# 2026-10-22 0.5.1 蓝色品牌与首页交互候选

- 可执行源码 `4bcb99afdad9bc72cdd19ff7e49e128a91bef474`；官网与插件接入 theme 1.2.0，19 份官方品牌素材核验通过。保留协议 v3、设备授权、Cookie 所有权和现有权限，Auth 源码与 Worker 未改。
- 本地候选 `cqu-quicklogin-0.5.1-canary.zip`：152054 bytes，SHA-256 `0029540913aadf1a5d0e380656ffe884beb6186e891364b7851c12ff307c693c`。ZIP CRC、14 个运行文件、manifest 0.5.1、build-info 来源与 dist 字节比对通过。该包未启用诊断 token，正式包需按合并提交重新构建，不复用此摘要。
- 扩展/官网类型检查、应用测试、发布工具测试、扩展构建/包检查、官网构建/7 页资源检查通过；首页 12 组视口/主题、鼠标/触摸/Space/Tab 与减少动态效果检查通过。候选未做真实大学 SSO 验收。
- 用户已授权 PR、CI 通过后合并上线与生产复验。PR CI、官网自动构建、正式 Canary 和商店 CD 状态待发布后独立记录；当前不将本地验证称为上线或商店上架。

---

# 2026-10-21 0.5.0 正式 Canary 与商店等待交接

[PR #32](https://github.com/cqu-moe/quick-login/pull/32) 的 7 项检查全通过后已合并，发布源码/标签 `v0.5.0`：`0b6ba77e54555558bb2b8251dd2fc1682d9530cb`。正式包 `cqu-quicklogin-0.5.0-canary.zip`，152024 bytes，SHA-256 `59df7e4469f389239349ff471a4d5b2e782cf21abea50f536d37ba1e812e0b8f`。主分支常规检查和 Canary 发布成功；实际认证下载 200、匿名 401，CRC/14 文件/manifest/build-info 与 CI 字节比对全部通过。

官网 Worker `ed62fc94-e34d-43b5-bee8-5aa34ff0eb2c` 已承接 100% 流量；页面显示 0.5.0，已加载公开脚本读回相同发布提交并与 CI 脚本一致。PR 的移动端设备组曾在扩展连接前遇到隔离学校 `BROWSER_DEADLINE`，保留失败证据后只重跑失败组一次，所有两轮业务、原生 alarm/ACK 负向控制和汇总通过；未修改断言。[主分支原生 E2E 39468618618](https://github.com/cqu-moe/quick-login/actions/runs/39468618618)也已在发布提交上完成四组各两轮、负向控制、证据准入及最终汇总，全部通过。

商店 CD [39468811125](https://github.com/cqu-moe/quick-login/actions/runs/39468811125)返回 `WAITING_REVIEW`，待审版本为 0.4.9；0.5.0 尚未上传、送审或上架。保持原审核及 Unlisted，后续只提交最新已核验候选，不撤审。签名候选 CRX 为 154069 bytes，SHA-256 `49848c938083a6b21c8676fd80ee1c94219aeb2ce9d59bf06fcae2557a61ed38`；它是准备产物，不是已上传证明。后续真实上传后单独记录实际回执。

已安装扩展的真实自动升级与大学 SSO 未验收；浏览器安全策略禁止扩展管理页访问，未绕过。主目录存在未跟踪报告冲突，fast-forward 已中止并保留原文件；使用独立工作树继续，详情与链接见[发布记录](quicklogin-release.md)。下方本地候选仅为历史，不能用于正式包校验。

---

# 2026-10-21 0.5.0 商店自动更新候选交接

候选源码 `619e8d1f41f585ca885a9091261f157cec67908e`，本地包 `releases/cqu-quicklogin-0.5.0-canary.zip`（151270 bytes），SHA-256 `232b93b5c0006cd8b84166548677150d58238b17905289879ca76eaef45cf0cf`。已通过 203 项应用测试、30 项发布工具测试、类型/构建/包/官网检查和两轴审查；包的 CRC、版本、来源及逐文件比对通过。正式 Canary 需在合并后按发布提交重新构建，不能复用本地候选摘要。

商店更新下载完成后会等待活动授权、同步、Cookie 写入和 ACK 结束，再自动应用；服务要求升级（含 worker 重启恢复）及“更新插件”按钮会触发合并、限频的商店检查。检查失败不改变登录状态，已解压版本仍手动更新原目录。保持设备身份/授权、Cookie 所有权和现有权限边界。

公开商店已读回 0.4.9；本机 Chrome 磁盘记录 0.4.6，运行态和延迟原因未验。浏览器安全策略阻止扩展管理页访问，真实商店升级及学校 SSO 尚未验收。0.5.0 当前未合并、未晋级官网 Canary、未上传或送审；Auth 未改动。详见 [发布记录](quicklogin-release.md)。

---

# 2026-10-20 商店自动发布交接

0.4.9 已由自动 CD 上传签名 CRX 并提交审核，Google API 于 22:57、22:58（Asia/Shanghai）两次确认 `PENDING_REVIEW`，获批后自动发布，未修改 Unlisted 设置。扩展源码 `8a42236dad09566255d165142a3b361e9c0676fd`；上传 `cqu-quicklogin-0.4.9-webstore.crx`（153440 bytes），SHA-256 `387e800f47c321baeff57a58e97345502ec73c9ff19e1025aa65c4f4d458eefa`。

PR 定版本、Canary 成功后自动检查商店；有版本待审时等待，每半小时取最新候选。工作流已 active；拒审或政策告警需人工处理，不会自动撤审。真实上传与幂等检查已通过；获批、商店安装及真实学校 SSO 仍待验收。运行链接与详细边界见 [发布记录](quicklogin-release.md)，配置与暂停见 [CD 运维](quicklogin-webstore-cd.md)。

---

# 2026-10-16 QUICKLOGIN-02 / 0.4.8 本地验证完成，未发布

- 可执行源码 `e1fde7ddf48c48fb3bc06250aadd568be46e1c93`；实际固定 Auth `870933794326b9d280dcf07f392c80c127fd7233`。两轮全新真实扩展/内部 Auth/原生容器/学校替身业务各16/16；40业务容器、40proxy、20镜像已独立确认消失。合成学校通过不代表真实大学登录通过。
- 本地候选 `.e2e/local-candidates/QUICKLOGIN-02-e1fde7d/cqu-quicklogin-0.4.8-canary.zip`：142522字节，14文件/CRC/manifest与源码/逐文件字节核对通过，SHA256 `62602b9765a78fe5dbf55a392bad1111b0a5186b4dbeb7d8c5956b3f336a6194`。旧候选未覆盖。
- 171项单测、10项发布测试、类型与构建/包检查及失败控制通过；既往transport500首败与尚未确定的原因如实保留。详见 [QUICKLOGIN-02报告](../e2e/results/QUICKLOGIN-02.md)。
- 本票未合入integration/main、未push、未创建标签、未部署Worker/官网、未上传或晋级canary、未操作商店。Auth仅作本地固定依赖，生产Worker版本不适用。父任务负责独立审查与integration推送。

---

# 2026-10-13 0.4.5 canary 与官网已发布

- [PR #15](https://github.com/cqu-moe/quick-login/pull/15) 在检查全绿后 squash 合并；发布源码与 `v0.4.5` 标签均为 `d4638e8c56b7b1f731336fb285d492ddc93343c7`。
- 正式包：`releases/cqu-quicklogin-0.4.5-canary.zip`，140464 bytes；SHA-256：`9230d2c344659c846501aa87dfcc73c30a938974d86addad378e3ebb8bfd4991`。
- [PR CI](https://github.com/cqu-moe/quick-login/actions/runs/38346063058)、[主分支 CI](https://github.com/cqu-moe/quick-login/actions/runs/38346178701) 和 [Publish canary](https://github.com/cqu-moe/quick-login/actions/runs/38346178672) 全部成功；142 项应用测试、10 项发布测试、类型检查、构建及包/网站检查通过。发布流程完成不可变包上传、R2 回读及 canary 从 0.4.4 晋级 0.4.5。
- 官网 `quick-login-website` [生产构建 d87dadb3-ac60-4d20-9d9a-34f5a7e8ec41](https://dash.cloudflare.com/a666c560407022706a52a703923548d5/workers/services/view/quick-login-website/production/builds/d87dadb3-ac60-4d20-9d9a-34f5a7e8ec41) 成功；真实浏览器已读回下载页版本/文件名/SHA 和 0.4.5 更新记录，线上引用本次 CI 的 `main-DvUMvUf9.js`、`main-CNhbyHtI.css`。
- CI 的公开 HTTP 验收遇到 Cloudflare challenge，已在真实浏览器补验：公开元数据为 0.4.5；携带现有登录会话的下载接口返回 HTTP 200 ZIP，保存后的字节与正式包完全一致，CRC、manifest、build-info 的版本/提交/协议指纹均通过；省略凭据时返回 HTTP 401，未遇到 challenge。浏览器点击下载的自动化事件未捕获到文件，实际字节验证使用同源会话 fetch，不将其表述为点击流程验收。
- 主分支 CI 产物与正式 canary 字节一致，已保存上述不可变本地包及 `releases/0.4.5.json`；未重新构造一个不同的本地候选包。
- 本轮动效/故障回归详见 [验收记录](../acceptance/2026-10-13-motion-responsiveness.md)。真实 Chrome 已安装扩展重载、学校 SSO 尚未验收；Auth 源码与 Worker 未修改。Chrome Web Store 未操作、未上传、未送审。

---

# 2026-10-14 0.4.6 遥测 v2 与商店送审

- 扩展 PR #17 合并、标签 `v0.4.6`，源码 `1f9130b9438715c230294bff08b25665b88f32a2`。CI 与 canary 发布成功。
- 真实 Auth 受控下载取得 `cqu-quicklogin-0.4.6-canary.zip`：141876 bytes，SHA-256 `62b45dcb09d1275ab0cd2c074dbb86fcdd3d2af2d6f13baaf7be4e0da8e46681`。CRC、14文件、版本、build-info 与源码一致。
- 商店包 `cqu-quicklogin-0.4.6-webstore.zip`：141509 bytes，SHA-256 `5795c1fd66537b407e52f78517bf27803fb31c4f012c5493d8664b0e2448278f`。13个运行文件与实际 canary 逐字节相同，manifest 只删除 canary 公钥。
- 用户明确授权上传、提交审核、通过后自动发布。Google 后台读回草稿0.4.6、状态待审核；确认勾选自动发布。当前已发布0.4.4，不把送审当作0.4.6已上架。保持Unlisted和既有权限。
- 商店说明同步中央内部账号标识/未连接独立安装标识、结果/耗时/有限错误分类，不上传 Cookie、账号凭据、输入内容。扩展无录制；自己的官网100%范围受控遮蔽录制，新PostHog项目662666，GeoIP关闭。
- Auth配套生产提交 `6aa18abfa01f8c128724ed7ddd95986cb3ec064e`，Worker `b8b25624-c507-4731-a9d1-c88f931f6e20`；RELEASE/QUICKLOGIN_SERVER_BUILD均实际读回匹配。官网Worker `6419558e-94bf-4189-a023-7cbecd5bb313`，页面下载链接实际显示0.4.6。
- 待完成：0.4.6商店审核与安装渠道升级、真实扩展遥测接收验收。学校目标站登录仍记未验证，不额外请求学校接口只为遥测。旧PostHog608620在全量迁移验收前保留。


# 2026-10-13 0.4.4 品牌与暖橙主题候选（本地，未发布）

- 扩展源码：`ca2ca90ed0791146985b99ec38ffc1ca879c70fe`。
- 本地候选包：`releases/cqu-quicklogin-0.4.4-canary.zip`，138767 bytes。
- SHA-256：`bdc1d68ffc3f1896499f2c0dda2015f0818c63e763757a98e9774cc0e1eea813`。
- ZIP 完整性、仅包含 dist、manifest 0.4.4、build-info 提交和逐文件字节比对通过。此 ZIP 保留为本地候选；合并后的正式 canary 由工作流按合并提交重新构建，不覆盖此候选。
- 扩展 typecheck、124 项测试、build、check:package、10 项发布工具测试及官网 typecheck/build/6 页资源检查通过。
- 四种宽度、双主题和暖橙色对比度已核对；弹窗使用构建产物与合成 chrome.runtime 状态，未加载真实扩展后台、未写 Cookie。官网验收阻断生产 API，不代表真实下载流程通过。
- Auth 配套仅为黑白品牌标识接入（源码 `acbd6f8`）；未部署 Worker。
- 官网 canary、官网生产部署、unpacked 扩展升级与真实学校 SSO 均未执行；Chrome Web Store 未上传、未送审。`release.py build` 生成的 publishedAt 字段是候选记录格式，不是线上发布证据。

---

# 2026-10-10 0.4.3 已送审

扩展源码 `ec565f422cb81cdf29e8efc0e1f84de44f46548f` 已合并，官网 canary 已发布；`cqu-quicklogin-0.4.3-canary.zip`（127149 bytes），SHA-256 `010839a52d837002fdfd15afb2d4e4b60b4498244f5f2a2999a7e37f30f5b36e`。商店最终 `cqu-quicklogin-0.4.3-webstore.zip`（126779 bytes），SHA-256 `991b8ab6100ec0b643c6c8ccbafa9850c089294b11b96cd3c2d9d7a803b27342`；Google 草稿 CRX 与源提交/运行文件匹配。

Auth `8e24696a364b627a9432c06719892a29350fbb57` 已由自动构建部署，生产 Worker `5c7d560d-271f-4047-b42b-5d3507c46e51`（100%）。store/canary 精确回调及 Origin 共存，原管理员会话已恢复。

商店条目 `ainapeknaclcpoioimonkodmoakhacjd` 已提交审核，免费、不公开，获批后自动发布；尚未上架。普通审核账号额度 2 台，无学校绑定，凭据只在 Google 保密审核字段。完整学校 SSO 与商店签名安装验收未执行，不以源码检查或协议测试替代。各渠道完整证据见 [发布记录](quicklogin-release.md)，商店字段见 [CHROMEWEBSTORE.md](../../CHROMEWEBSTORE.md)。

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

# QuickLogin 0.2.3 交接

当前修复：Auth `cb4389300e261996551ffac79450c2f66277af5d`，EXT `683081ad9b38b43219d024916b9a4f193f040efc`。包为 `releases/cqu-quicklogin-0.2.3-canary.zip`，SHA-256 `046cfbb810f7379a366f5a6b882374f46230f7758eba1bb00227e909af021770`。

Worker `22014c4d-c283-4f5f-b12d-557ec2d4ee74`（100%）与 Container 68（5 healthy）已上线。Ego 原设备 cloud ready / Cookie applied / ACK 已成功；Chrome 0.2.1 仍需更新至 0.2.3 并重载，无任务恢复尚待该设备读回。详见 [发布记录](quicklogin-release.md)。本次已复现 Cookie 导出缺字段、结果处理异常未结算任务和无任务设备缺失调度。证据与修复范围见 [故障记录](quicklogin-023-preparing-incident.md)。

用户 Chrome 未操作。0.2.1 使用同一 Cookie 后端修复，但无任务恢复需要 0.2.3；更新包时覆盖原加载目录并重载，保留现有设备身份。

## 历史交接

# QuickLogin 0.2.1 最终交接

源代码已合入并推送两个 main；Auth 已完成生产部署；最终安装包为 `releases/cqu-quicklogin-0.2.1-canary.zip`。确切提交、Worker/Container、SHA-256 和验证结果统一见 [发布记录](quicklogin-release.md)。

**尚未通过学校自动登录业务验收。** 实际 Ego 无损升级和服务端状态对账已确认，设备目前“等待验证恢复”，尚无新版 Cookie ACK。不要把部署成功、健康 200 或测试通过表述成学校已自动登录。

后续工作的具体观测和验收条件见 [运行状态交接](quicklogin-021-runtime-status.md)。用户 Chrome 未操作，升级应覆盖原加载目录并重载，保留设备身份；不要卸载重装来绕过问题。

## 历史实施交接

# QuickLogin 实施交接

交接时间：2026-09-11（Asia/Shanghai）

## 2026-09-15 协议 v2 更新

- 根因：网站总开关关闭再开启会令每个启用设备的 generation 前进两次；0.1.3 的
  status 心跳把本地 generation 当作必须相等的写栅栏，409 `STALE_GENERATION` 后又不
  获取服务器当前值，形成永久重试循环。
- 新协议：status 请求字段为 `observedGeneration`。服务端始终返回当前
  `DeviceStatus`；观察值过期时仍更新 lastSeen/IP/browserVersion，但保留服务器已有
  appliedVersion。只有观察值等于当前 generation 时才接受客户端 appliedVersion。
- refresh/export 仍使用精确 generation/sessionVersion fence；OAuth grant、设备 ID、
  Cookie 所有权和验证码租约均未放宽。
- Auth：`b5ebf82`；生产 Worker
  `bdbb2023-62a7-439b-861a-22f0863a73d5`，100% 流量。
- EXT：`974d703`，版本 0.1.4，协议版本 2。
- 安装包：`releases/cqu-quicklogin-0.1.4-canary.zip`；SHA-256
  `68946df7d2c230b8c1f233aa900bc5e277f4205224c9402fc3c33e96e4fcb94c`；只含 7 个
  dist ZIP 条目，完整性检查通过，未上传商店。
- 自动化：Auth 85 files / 741 tests、DO 22 files / 217 tests；EXT 14 files /
  47 tests、typecheck、build、package check 通过。
- 待真实验收：在 Chrome 加载 0.1.4 后，status 应由 409 变 200，服务器返回当前
  generation，插件写回 Cookie 后 Auth 设备列表应恢复 online。该步骤不能用本地测试替代。

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
npm test                PASS — 13 files, 40 tests
npm run build           PASS — background/content/popup/manifest
npm run check:package   PASS — 6 files, 3 manifest references
```

Auth：

```text
npm run typecheck       PASS
npm run typecheck:do    PASS
npm test                PASS — 55 files, 493 tests
npm run test:do         PASS — 12 files, 123 tests (exit 0)
npm run build:frontend  PASS — 206 modules
```

`npm run test:do` 会打印 `CquLoginContainer` 在本地 workerd 未启用的 uncaught exception。单独运行既有 `test/do/cqu-session.do.test.ts` 可复现，同样 62/62 通过且退出 0；它是当前容器测试夹具的已知噪音，不作为真实容器或生产通过证据。

## 发布包

- API v1 本地包：`releases/cqu-quicklogin-0.1.3-v1.zip`
- API v1 版本提交：`39377c0`
- API v1 SHA-256：`683449397ce213858bd01576a0ca91c422b4d2769e08aa9bb21c92dccd30417a`
- API v1 验证：14 files / 46 tests、typecheck、build、package、ZIP integrity 与旧路径静态扫描通过；未上传商店

- 文件：`releases/cqu-quicklogin-0.1.2-canary.zip`
- 内容：仅 `dist/` 的 7 个 zip 条目（6 个文件和 `assets/` 目录）
- 对应扩展提交：`09e0158`
- SHA-256：`498d2c45ee7b24b5f4cf37042aa9ed3e4bc4a1cca896df7489180d620e44fa1f`
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
- Auth Worker：版本 `0eefd288-6ecd-44db-8bd3-88eb7da9f479`，`QUICKLOGIN_DEVICE_MODE=on`。
- 瞬时失败重试：Auth `d54142b`；前 5 分钟每 1 分钟，5–30 分钟每 3 分钟，30 分钟–2 小时每 5 分钟，之后 10、20、30 分钟并封顶 30 分钟；生产健康端点已由浏览器读回 `status=ok`。
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

## 2026-09-16 PostHog 0.3.0 候选

- 实现提交：`bc54201760d3314aa80b6831b5d354133ac47802`
- 构建来源提交：`8bb2cb634729f090af18a118be403abacc2dc7eb`
- 本地包：`releases/cqu-quicklogin-0.3.0-canary.zip`
- SHA-256：`c55434507cab339d18c0e6e23346810d3a920fd1694f34cf2bef8c0962e9910e`
- 包内容：仅 `dist/`，ZIP integrity、manifest 0.3.0 与 build-info commit 已核对
- 自动门禁：typecheck、18 files / 83 tests、build、package 全部通过
- PostHog 配置：已从 US 项目 `608620` 动态读取公共项目 token 构建，采集 host 为 `https://us.i.posthog.com`
- 真实验收：unpacked Reload、连接/同步/Cookie 应用事件与异常回读均 `NOT RUN`
- Chrome Web Store：未上传、未发布

## 2026-09-16 PostHog 0.3.1 CSP 修复

- 修复提交：`9631cf176a085b2b9167a48f24ae45e29ee424bd`
- 本地包：`releases/cqu-quicklogin-0.3.1-canary.zip`
- SHA-256：`0fd1e571c07c4e1bd400dc4e784276b6ebf3ba5e9ae1ac7b4a655cfd865dac92`
- 根因：0.3.0 增加 PostHog CSP 时，`connect-src` 漏掉 `https://auth.cqu.moe`，导致 capabilities、token、registration 和 reconcile 请求被 Chrome 在扩展内部拒绝
- 修复：CSP 精确允许 `self`、`https://auth.cqu.moe`、`https://us.i.posthog.com`；打包门禁新增精确 CSP 断言
- 自动门禁：typecheck、18 files / 83 tests、build、package、ZIP integrity 全部通过
- 真实验收：需要在 `chrome://extensions` 对现有 unpacked 扩展点击“重新加载”后再测试开关；未上传、未发布 Chrome Web Store

## 2026-09-16 PostHog 0.3.2 远程配置修复

- 修复提交：`1c7de1a58e364cd8a128cbbc3b77f715e5fd3c01`
- 本地包：`releases/cqu-quicklogin-0.3.2-canary.zip`
- SHA-256：`b8b16dc4c164dcfbeb0e9ac1ba90476818e3addd86fa6e82ebf8293314ea603a`
- 根因：`advanced_disable_feature_flags` 不会关闭 PostHog `/array/<token>/config` 远程配置请求，因而被精确 CSP 拒绝
- 修复：改用当前 SDK 的 `advanced_disable_flags=true`，扩展不再请求 flags/remote-config；package gate 直接检查源码配置
- 自动门禁：typecheck、18 files / 83 tests、build、package、ZIP integrity 全部通过
- 当前 Chrome unpacked 目录已备份 0.3.1 并原位更新为 0.3.2；仍需点击 Reload 验证实时开关

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

## 2026-10-13 0.4.5 动效与响应候选

独立工作区基线 `767146b`，修改未提交，不能用该基线代表修改后的发布 commit。插件和官网响应修复、动效优化及回归已准备，验收范围见 `docs/acceptance/2026-10-13-motion-responsiveness.md`。本地构建目录为 `dist/`、`website/dist/`；正式包 `cqu-quicklogin-0.4.5-canary.zip` 尚未生成，SHA-256 待发布后记录。推送、CI、canary 发布、官网部署、安装扩展重载及真实学校 SSO 均未验收；无 Auth 或 Chrome Web Store 变更。

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

## 2026-10-20 0.4.9 PostHog 修复发布交接

- [PR #29](https://github.com/cqu-moe/quick-login/pull/29) 已合并；源码/标签 `v0.4.9`：`8a42236dad09566255d165142a3b361e9c0676fd`。
- 正式包：`releases/cqu-quicklogin-0.4.9-canary.zip`，151421 bytes；SHA-256：`c38a7d458a86635c65ffab8aa1283a145d0b42d2810fd22424eccd410f62a669`。实际认证下载与 CI 包一致，CRC/manifest/build-info 已通过；认证 200、匿名 401。
- PR 常规检查及四组两轮 MV3 E2E 全部通过；主分支普通检查、canary 发布和官网生产构建成功。生产版本 `54be953c-85ca-4692-a8e8-2cd5aac34e58` 为 100% 流量。
- 官网真实事件在 `2026-10-20 12:15:09.138 +08:00` 入库：SDK `1.438.12`、release `0.4.9+8a42236dad09566255d165142a3b361e9c0676fd`、代理标记 `https://p.cqu.moe`；测试标识、GeoIP 禁用和个人资料禁用均保留。
- 代理告警待每日重新计算，未手动关闭。已安装扩展重载、真实学校 SSO 仍待独立验证；Auth 和 Chrome Web Store 未操作。流水线及部署证据见同期 `quicklogin-release.md`。
