# 管理台公告与外观主题

本页对应0.12开发版，生产升级和实际验收状态见 [deployment.md](deployment.md)。目录划分见 [architecture.md](architecture.md)。管理台采用同源API与现有Authentik会话，发布/停用公告沿用CSRF与幂等请求编号。

## 游戏公告

登录管理台后进入“游戏公告”。该页是全服管理，不要求先选择某个存档：

1. 填写标题（1–100字）和正文（1–2000字），右侧可预览纯文本与换行。
2. 到期时间使用浏览器本地时间，提交时转成Unix秒；留空表示长期有效。过去或无效时间会在提交前拒绝。
3. 点击“发布公告”。网络不确定时保留输入并复用请求编号，避免重试产生重复公告；明确成功后清空表单并刷新列表。
4. 列表显示展示中、已到期或已停用状态，以及发布者、发布时间和到期时间。
5. 点击“停用此公告”，再确认停用。记录保留，后续停止展示；已经读到的通知不会被撤回。

服务端向已同步在线客户端推送 `client_notice`；登录同步后延迟约1秒显示有效公告，以免初始资源/角色加载尚未结束。停用与到期后不再向后续登录发送。这里管理的是公告消息，不是奖励邮件。

| 接口 | 输入/输出 |
| --- | --- |
| `GET /api/admin/announcements` | `{announcements:[{id,title,body,active,created_at,expires_at,author}]}` |
| `POST /api/admin/announcements` | `{action:'publish',title,body,expires_at?}` |
| `POST /api/admin/announcements` | `{action:'disable',id}` |

POST成功返回 `{ok:true,announcement}`。公告内容以文本渲染，不使用HTML插入；前端不会将公告草稿或身份凭据写入本地存储。后台和游戏真实显示仍应在当前部署版本验收，不能用前端构建代替。

## 浅色、深色与跟随系统

登录页右上角和已登录页面顶部都有“外观”选择器：

- **跟随系统**：根据操作系统的浅色/深色偏好显示；系统偏好改变时立即跟随。
- **浅色**或**深色**：手动固定，不被系统自动变化覆盖。

浏览器只保存 `frog-admin-theme` 这个主题偏好；密钥、OAuth令牌和密码仍不持久化到localStorage。刷新后保留选择，同源的其他标签页也会同步；浏览器禁用存储时本页仍可切换主题。首次挂载前会先应用主题，减少从浅色闪到深色的情况。

深色主题通过独立的颜色变量和CSS覆盖侧栏、面板、输入框、表格、通知、庭院组件及明信片预览周边的背景/文字。游戏明信片图层保持原色，不使用反色滤镜处理图片或整页。

实现文件均在 `admin-ui/src/`：`Announcements.svelte`、`announcements.js`、`ThemeSwitch.svelte`、`theme.js` 和 `themes.css`。验证命令从仓库根目录执行：

```powershell
npm --prefix admin-ui test
npm run admin:build
```

前端回归覆盖公告长度/时间校验、纯文本保留、状态计算；主题测试覆盖记忆偏好、系统实时切换、手动覆盖、跨标签同步、受限存储及只写主题键。公告HTTP/WebSocket发布、登录展示、停用与幂等由服务端回归验证。
