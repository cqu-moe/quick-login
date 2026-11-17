# CI/CD

本文描述当前流水线的责任边界和可在本机复现的命令。自动化通过不表示已发布、已部署或已完成真实浏览器验收。

## GitHub Actions

`Checks / verify` 是稳定的必检候选：PR、main 手动触发都会执行同一个 composite 验证；main 提交在全部验证通过后才打包并上传私有 Actions artifact。当前仓库管理接口无法确认分支保护配置，不能假设该检查已经被设为 required；有权限的维护者应在 GitHub 分支保护中使用 `Checks / verify`。

验证顺序：

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run test:release
pnpm run build
pnpm run check:package
pnpm run typecheck:website
pnpm run build:website
pnpm run check:website
```

PR 也会在上述门禁全部通过后执行打包演练，但不上传构建包。main 的完整流程在同样门禁后执行：

```sh
python3 scripts/package_ci.py --output ci-artifacts
```

输出包含扩展 ZIP、官网 ZIP、`build.json` 和 `SHA256SUMS`。这些是私有 GitHub Actions artifacts，只在登录且有仓库权限时可下载；它们不挂在 GitHub Release、不提供公开直链，也不是 Chrome Web Store 包。下载后可在 artifact 目录执行：

```sh
shasum -a 256 -c SHA256SUMS   # macOS
sha256sum -c SHA256SUMS       # Linux
unzip -t cqu-quicklogin-*.zip
unzip -t quicklogin-website-*.zip
```

`scripts/package_ci.py` 复用正式发布脚本的确定性 ZIP、CRC 与逐字节回读逻辑，并校验 `package.json`、manifest、`build-info.json` 的版本和源码提交；依赖一致性由 frozen install 在打包前保证。它不需要发布说明，也不生成可传给 `release.py publish` 的 canary 记录；因此 PR 包不改变业务版本，也不能进入私有 R2 发布通道。

触发与并发规则：

- PR 使用 `pull_request`；同源分支的普通 push 不再触发第二份 Checks，避免重复。
- main push 和 `workflow_dispatch` 使用 `checks-<ref>` 并发组，新运行可取消旧运行。
- `verify` 20 分钟超时；发布 select/publish 分别 5/30 分钟，回滚 10 分钟。
- 发布与回滚共享 `quicklogin-canary-publish` 并发组且不取消进行中的操作，保留现有互斥。

## 构建输出安全

扩展侧由 `pnpm run check:package` 检查：只允许批准的权限和 CSP，manifest 引用必须存在，并拒绝源码 map、`.env`、私钥、`client_secret`、token 导出和远程动态代码。官网侧由 `pnpm run check:website` 递归检查输出，同样拒绝 symlink、源码 map、`.env`、私钥和 `sourceMappingURL`。CI 打包前还会再次扫描两类输出。

PostHog 项目 token 是公开浏览器端标识，不是服务端 secret。Cloudflare 官网构建命令不传入 R2 或发布凭据。

## 官网 Cloudflare Builds

官网继续由 Cloudflare Workers Builds 从 main 构建部署；GitHub Actions 不部署官网。配置就绪条件：

1. Cloudflare 已登录并连接本仓库的 main，根目录为仓库根目录；分支触发保持现状。
2. Workers Builds 变量设置 `PNPM_VERSION=11.19.0`、`NODE_VERSION=22.22.3`、`SKIP_DEPENDENCY_INSTALL=1`。裸 `pnpm` 必须由 `PNPM_VERSION` 精确引导，依赖必须由下方 build command 统一安装。
3. Build command 使用下方命令，不能用只构建官网的旧命令。
4. Deploy command 使用下方命令。

推荐 Build command：

```sh
pnpm install --frozen-lockfile && pnpm run build:cloudflare
```

`build:cloudflare` 执行扩展类型检查、单元测试、发布脚本测试、扩展构建与包检查、官网类型检查、构建和结构检查。任一步失败都会停止，不执行部署。仅支持迁移后的 pnpm 提交；旧 npm 标签不再提供重建兼容。

Deploy command：

```sh
pnpm run deploy:website
```

2026-11-18：上述命令和变量已在 Cloudflare 控制台保存并重载验证。本次变更未触发构建或部署；控制台仍显示“GitHub 用户或组织信息获取失败”，且 Connector 可用性未通过真实云端构建确认。

## 发布与回滚边界

版本发布仍由现有 `Publish canary` 工作流执行：先完整验证，再构建带发布说明的正式 canary ZIP，创建不可变版本标签，条件写入私有 R2，读回包和元数据后推进 canary 指针。本文的 CI ZIP 不参与该流程，也不会 bump 业务版本。

`Roll back canary` 仍只能从 main 手动 dispatch，按已发布版本读取并校验 R2 对象后显式恢复指针；它不删除或覆盖历史包。

`Publish Chrome Web Store` 在 Canary 工作流成功后及每 30 分钟运行一次，也可从 main 手动触发。它与 Canary 发布、回滚共用同一个并发组，从私有 R2 当前 Canary 指针读取最新候选，校验元数据、ZIP、摘要与来源后生成并签名商店 CRX。已有版本待审时正常结束，下次重新读取最新候选；不撤审、不逐个补发中间版本。拒审、政策告警或不认识的状态使任务失败。用户已授权这条流程自动上传、送审、获批后发布，保持 Unlisted。配置与恢复见 [商店 CD 运维](operations/quicklogin-webstore-cd.md)。

现有发布环境与配置项只记录名称：GitHub environment `quicklogin-release`；变量 `POSTHOG_PROJECT_TOKEN`、`R2_BUCKET`；secrets `R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`CLOUDFLARE_ACCOUNT_ID`。官网部署由 Cloudflare Git integration 持有部署权限，当前没有对应的 GitHub Actions website 环境。
