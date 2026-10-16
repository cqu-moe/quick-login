# QUICKLOGIN-03 原生权限验收（pending，未运行）

自动化加载 unpacked MV3 扩展时，Chrome 已授予 manifest 声明的 host 权限，不能代表用户实际看到并操作了原生权限界面。本文的 allow/deny 尚无人工证据，不由 fake Chrome、CDP 构造权限结果或 package 检查代替。

只在独立临时 Chrome profile 执行；使用已审查的构建及合成 Auth/学校环境，禁用系统钥匙串，不使用日常浏览器、真实学校账号或生产服务。记录构建 sourceCommit、Auth pin、Chrome 版本、操作时刻和脱敏截图。尚未接受的02候选不作为已验收安装包。

1. 在 `chrome://extensions/?id=igfidegfgfoofnoncpmbcokbffjmmook` 的详情/网站访问权限界面，记录本机实际可见的权限文案。若渠道有安装权限确认，先拒绝/取消，确认没有安装成功或本地授权/学校 Cookie；unpacked 无该提示时，明确记为“此渠道不可复现”，不能记录为通过。
2. 在浏览器原生网站访问权限界面拒绝/撤销学校 origin 的访问；若弹出确认，亲自选择拒绝。经真实 OAuth 和学校绑定触发同步，记录 popup 的权限失败/修复入口，原生 Cookie store 中没有新学校 Cookie，Auth 无本轮成功 receipt。已有外来/手动 Cookie 应仍保留。
3. 在同一原生界面重新允许准确学校 origin；若存在确认，亲自选择允许。使用 popup 的公开重新同步动作，读取实际学校 Cookie 属性、当前版本 receipt/ACK，以及合成学校业务页面。设备身份不应因权限修复改变。
4. 若 Chrome/渠道不提供对应 allow/deny UI，记录实际限制和未验证项，不能以脚本调用 listener、修改状态或伪造权限 grant 充当人工操作。关闭并移除本轮临时 profile/合成资源，附 cleanup 结果。

人工结果：**pending**。真实大学学校和用户日常安装另属 QUICKLOGIN-04；本票无商店、发布或生产部署操作。
