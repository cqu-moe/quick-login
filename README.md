# CQU 快捷登录

Chrome MV3 扩展，为每个安装实例维护独立的重庆大学统一认证会话。Auth 负责设备授权、额度、云端学校会话和撤销；扩展后台按版本同步限定于 `sso.cqu.edu.cn` 的 Cookie，不读取或保存学校密码。

当前源码版本为 `0.4.3`，使用协议 `3`；各渠道发布状态见 [发布记录](docs/operations/quicklogin-release.md)。Auth 与插件共用状态契约，通过 reconcile 对账、持久恢复作业、带完整版本的 Cookie 导出和应用回执完成同步。网络失联、学校密码问题、设备退出和浏览器同步失败分别处理；只有当前会话已写入并确认后才显示“已就绪”。[完整设计](docs/superpowers/specs/2026-09-15-quicklogin-020-protocol-design.md)记录状态、恢复与升级规则。

本仓库是正式扩展源码；`experiment/` 仅保留早期验证材料，不能作为 Chrome 加载目录。

## 本地构建

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run check:package
```

在 `chrome://extensions` 开启开发者模式，选择“加载已解压的扩展程序”，目录必须是本仓库生成的 `dist/`。不要选择仓库根目录或 `experiment/extension/`。

已有 0.1.x 安装时，在原加载目录替换为新包内容后重新加载，保留设备身份和授权。升级会重新核验 Cookie，不沿用旧版“已同步”标记。`build-info.json` 记录源码提交、协议版本和共享契约指纹。Auth 设置页的“重新连接此设备”通过限于 Auth 来源的一次性消息完成授权恢复，避免误占新设备名额。

## Auth 公开配置

扩展只包含公开配置，定义在 `src/shared/config.ts`：Auth origin、public OAuth `clientId` 和协议版本。正式构建前必须让这些值与 Auth 管理模型登记的客户端一致：

- public client，`tokenEndpointAuthMethod=none`，不使用 `client_secret`；
- PKCE S256 必选，不能跳过 consent；
- 固定回调 `https://<extension-id>.chromiumapp.org/`；
- scope 为 `openid offline_access cqu:quicklogin:device`；
- CORS Origin 为精确的 `chrome-extension://<extension-id>`。

当前 canary 使用固定扩展 ID `igfidegfgfoofnoncpmbcokbffjmmook` 和 public clientId `cqu-quicklogin-chrome`。Chrome Web Store 条目 ID 为 `ainapeknaclcpoioimonkodmoakhacjd`，两个回调已登记；Origin 配套与提交状态见 [商店材料](CHROMEWEBSTORE.md)。

## 开关和所有权

网站总开关控制整个账号；插件子开关只控制当前安装实例。关闭总开关保留名额和子开关意图；退出设备会立即撤销该 grant。额度按已启用且未退出的设备计数，降低额度会停用较旧设备，不会退出它们。

扩展只覆盖自己仍能通过摘要确认拥有的 SSO Cookie。遇到外来 `SOURCEID_TGC` 默认保留；用户必须明确选择“切换为快捷登录”才允许一次替换。手动模式继续心跳和云端维护，但暂停本地覆盖。

## 验证边界

自动化结果和真实浏览器验收分开记录在 [验收记录](docs/acceptance/quicklogin.md)。迁移、客户端登记、mode 切换和发布步骤见 [发布门禁](docs/operations/quicklogin-release.md)。本地测试通过不代表已部署、学校真实页面已登录或 Chrome Web Store 已批准。


## 官网与版本发布

官网源码位于 `website/`，使用 `npm run dev:website` 预览；生产构建为 `npm run build:website`，检查为 `npm run typecheck:website` 和 `npm run check:website`。输出 `website/dist/` 不进入扩展 ZIP。

发布到私有 R2 由 `vX.Y.Z` 标签触发，要求版本一致且提交已属于 main。CI 先通过门禁，校验版本化 ZIP 后上传并切换当前版本；Auth 每次下载校验会话和内测资格。初次需要配置 R2、Auth binding 与 GitHub 环境，详见 [官网验收记录](docs/acceptance/quicklogin-website.md)。

官网通过 Cloudflare Workers Builds 连接 main 部署，Worker 名称为 `quick-login-website`；GitHub Actions 只做检查和标签触发的插件包发布。

Cloudflare 的根目录保持仓库根目录。根级 `wrangler.jsonc` 是官网唯一部署配置，`assets.directory` 指向 `website/dist`，`previews: {}` 支持默认 `npx wrangler preview`；扩展构建目录 `dist` 不会作为网站资源发布。
