# CQU 快捷登录

Chrome MV3 扩展，为每个安装实例维护独立的重庆大学统一认证会话。Auth 负责设备授权、额度、云端学校会话和撤销；扩展后台按版本同步限定于 `sso.cqu.edu.cn` 的 Cookie，不读取或保存学校密码。

当前协议版本为 `1`。本仓库是正式扩展源码；`experiment/` 仅保留早期验证材料，不能作为 Chrome 加载目录。

## 本地构建

```sh
npm install
npm run typecheck
npm test
npm run build
npm run check:package
```

在 `chrome://extensions` 开启开发者模式，选择“加载已解压的扩展程序”，目录必须是本仓库生成的 `dist/`。不要选择仓库根目录或 `experiment/extension/`。

## Auth 公开配置

扩展只包含公开配置，定义在 `src/shared/config.ts`：Auth origin、public OAuth `clientId` 和协议版本。正式构建前必须让这些值与 Auth 管理模型登记的客户端一致：

- public client，`tokenEndpointAuthMethod=none`，不使用 `client_secret`；
- PKCE S256 必选，不能跳过 consent；
- 固定回调 `https://<extension-id>.chromiumapp.org/`；
- scope 为 `openid offline_access cqu:quicklogin:device`；
- CORS Origin 为精确的 `chrome-extension://<extension-id>`。

当前 canary 使用固定扩展 ID `igfidegfgfoofnoncpmbcokbffjmmook` 和 public clientId `cqu-quicklogin-chrome`，均已在 Auth 生产环境读回。Chrome Web Store 正式 ID 仍需发布前另行核对。

## 开关和所有权

网站总开关控制整个账号；插件子开关只控制当前安装实例。关闭总开关保留名额和子开关意图；退出设备会立即撤销该 grant。额度按已启用且未退出的设备计数，降低额度会停用较旧设备，不会退出它们。

扩展只覆盖自己仍能通过摘要确认拥有的 SSO Cookie。遇到外来 `SOURCEID_TGC` 默认保留；用户必须明确选择“切换为快捷登录”才允许一次替换。手动模式继续心跳和云端维护，但暂停本地覆盖。

## 验证边界

自动化结果和真实浏览器验收分开记录在 [验收记录](docs/acceptance/quicklogin.md)。迁移、客户端登记、mode 切换和发布步骤见 [发布门禁](docs/operations/quicklogin-release.md)。本地测试通过不代表已部署、学校真实页面已登录或 Chrome Web Store 已批准。
