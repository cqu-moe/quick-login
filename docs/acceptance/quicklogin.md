# QuickLogin 验收记录

记录日期：2026-09-11（Asia/Shanghai）

范围：本地代码、自动化测试、构建、生产 canary 配置，以及 Ego Lite Chromium 152 的真实授权、Cookie 写入和学校业务落地。Google Chrome 最终构建复测、长期观察与商店发布仍不在本次已通过范围内。

## 自动化证据

- EXT 协议、授权、同步、Cookie journal、登录页检测和 popup 测试：见 Task 17 全量命令输出。
- AUTH 协议、账号/设备 DO、OAuth provider、验证码租约、CQU 会话回归：见 Task 17 全量命令输出。
- 五会话短测：沿用 [five-session-verification.md](../five-session-verification.md)，不重复付费或真实登录压测。

自动化与 fake clock 只证明本地状态机和协议，不等同真实学校业务登录或长期会话并存。

## 真实用户路径

| ID | 结果 | 环境与证据 | 原因 |
| --- | --- | --- | --- |
| A01 | PASS（Ego Lite） | 独立 Ego Lite TaskSpace、Chromium 152、固定扩展 ID；完成 OAuth、设备注册、启用、云端 ready 与本地 Cookie 写入 | Google Chrome 最终构建仍需单独复测 |
| A02 | PASS（Ego Lite） | CAS 入口最终到达 `https://my.cqu.edu.cn/workspace/cas`，标题“智慧教务 - 重庆大学” | 未以 Cookie/302/new-ST 代替业务页面结果 |
| A03 | NOT RUN | 需要真实 Chrome 多 tab | 未执行 |
| A04 | NOT RUN | 需要删除插件管理的真实 SSO Cookie | 未执行 |
| A05 | NOT RUN | 需要真实浏览器故障注入 | 本地单测覆盖重试预算，但不冒充实测 |
| A06 | NOT RUN | 需要学校真实登录表单 | 未执行 |
| A07 | NOT RUN | 需要真实手动输入路径 | 未执行；不会保存学校信息 |
| A08 | NOT RUN | 需要普通 profile 的外来 TGC | 本地合成测试覆盖归属保护 |
| A09 | NOT RUN | 需要真实在途下载/写入 | 本地 generation 测试通过，真实浏览器未跑 |
| A10 | NOT RUN | 需要已部署 Auth 与插件 | 本地 DO 测试覆盖开关保留 |
| A11 | NOT RUN | 需要已部署 Auth 与两个安装实例 | 本地 provider/撤销测试通过 |
| A12 | NOT RUN | 需要离线设备重连 | 未执行 |
| A13 | NOT RUN | 需要管理员真实额度操作 | 本地 preview-changed 测试通过 |
| A14 | NOT RUN | 需要管理员真实额度操作 | 本地 quota 状态机测试通过 |
| A15 | NOT RUN | 需要 Worker 停止、Chrome 重启和升级 | 未执行 |
| A16 | NOT RUN | 需要真实课表认证与设备重登并发 | 本地共享 OTP 租约测试通过 |
| A17 | NOT RUN | 需要两个真实插件授权 | 本地 Better Auth provider 测试通过 |
| A18 | NOT RUN | 需要 1h/7h/7d 观察窗口 | fake-clock 状态机覆盖不作为长期实测 |

## UI 检查

- 代码级键盘、原生按钮/表单语义、小屏换行、quota 0 与撤销状态：PASS（自动化与静态复查）。
- Ego Lite 真实 popup 状态与学校页面不遮挡：PASS；完整键盘焦点遍历和 Google Chrome 截图：NOT RUN。

## 发布边界

- canary 额度映射：PASS，唯一旧 QuickLogin 用户显式映射为 5 台，preview 无缺失或冲突。
- canary OAuth client：PASS，固定 ID、PKCE、回调、scope、Origin 和 official metadata 已生产读回。
- Auth 部署和 mode on：PASS，生产设置页读回 `masterEnabled=true / deviceLimit=5 / used=2`。
- Chrome Web Store：NOT RUN。

生产探针：workers.dev health 返回 200；无令牌设备注册返回 401、精确反射 canary Origin、`Cache-Control: no-store`，证明 mode 已开启且授权闸仍生效。自定义域的命令行 health 请求被现有 WAF challenge 返回 403；已登录真实浏览器中的设置页和 API 正常返回 200。

真实浏览器故障闭环：初次授权后 token endpoint 为 200，但设备注册连续 401；Service Worker 请求头确认 Bearer、scope、`ql_grant` 与扩展 Origin 都存在。根因是 Worker 验签通过公开 Auth 域自取 JWKS，受到 WAF challenge。部署 Auth `60e7c8f` 后，扩展 `b5ca451` 复用已保存 grant 注册成功，未重复授权。

Cookie 写入第二阶段在 Chrome/Ego 中复现为 `getAll` 漏报 host-only Cookie，而单条 `get` 能读到同一条目；空值 `clientThemeKey` 又不会形成可持久化条目。Auth `11a2f2b` 在完整校验后剔除空值非 TGC 占位 Cookie，EXT `855ab9e` 使用 URL 作用域 `getAll` 加严格单条 `get` 回退，并继续核对 name/domain/path/storeId 和完整属性摘要。部署 Worker `c9cac439-bdff-4cc7-8bc0-f9721ffebc15` 后，Ego Lite popup 显示“快捷登录已准备”，学校 CAS 实际落到智慧教务业务页面。
