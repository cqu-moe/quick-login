# Chrome Web Store 素材

## 0.5.2 一起提交（2026-10-22）

商店图标、屏幕截图和小型宣传图块统一为官网蓝色，随 0.5.2 一起更新。用户已授权 PR 检查全绿后合并发布、生产复验及三项素材更新送审；各步骤完成后分别记录读回证据。

- 商店图标：`../public/icons/icon-128.png`，128×128，复用当前扩展蓝色图标；不再另造一份可能失步的图标。
- 屏幕截图：`screenshot-ready.html` / `screenshot-ready.png`，1280×800。沿用已就绪画面的排版，改用蓝色标识、淡蓝背景和修复后 390×468 的面板。
- 小型宣传图块：`promo-small.svg` / `promo-small.png`，440×280。复用 `../public/brand/logo.svg` 的 Path 标识、品牌蓝 `#0850AB` 与非官方声明。

`popup-ready.png` 来自本地 `website/popup-preview.html`，它复用扩展样式，并展示用户提供截图中的就绪状态。组合图明确标注「扩展界面预览」；没有伪造登录回执、写入 Cookie 或验证新的学校会话。真实工具栏弹窗的尺寸验证由 `npm run test:popup` 独立完成。下一版若使用「扩展实际界面」文案，须从正式候选的真实就绪态重新截图。

扩展面板的尺寸、布局和控件保持原样。官网响应式展示仅在 `website/src/popup-preview.css` 覆盖，不能反向修改扩展布局。

提交时将上述三项一起替换，保存并刷新核对，再随新版本提交审核。代码包自动上传不代表商品详情图片已经替换；分别记录草稿保存、送审和发布状态。

## 历史素材

- `popup-reconnect.png`：0.4.3 实际扩展弹窗截图（390×468），未修改 UI 状态或文案。
- `screenshot-reconnect.html` / `screenshot-reconnect.png`：将上述真实截图与授权恢复说明排入 1280×800 商店画布，不模拟“已就绪”或学校登录。

商店字段和状态见仓库根目录 `CHROMEWEBSTORE.md`。审核账号密码不存入仓库。
