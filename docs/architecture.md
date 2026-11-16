# 源码目录与模块边界

本文对应按模块整理后的 **0.12 开发分支**。生产集群当前仍为0.11；目录迁移、功能存在和自动测试通过不等于整份复刻路线已经完成。部署与原生验收以 [复刻路线](replication-roadmap.md) 和 [部署说明](deployment.md) 为准。

除特别说明外，本文及其他开发说明中的命令均从仓库根目录 `private_server` 执行。根目录JavaScript只保留 `server.js`、`start_admin.js` 两个稳定启动入口，不再放业务实现、测试和打包脚本。

## 运行代码：src

| 目录/文件 | 职责 | 主要文件 |
| --- | --- | --- |
| `src/server.js` | 应用组合入口，HTTP/WebSocket路由、会话检查、原生协议适配、初始同步和定时推进 | 从下列模块组装服务；根 `server.js` 仅加载它 |
| `src/paths.js` | 定位仓库根目录，使源码迁移不改变数据/资源默认路径 | `PROJECT_ROOT`、`fromRoot` |
| `src/core/` | 持久化与基础数据能力 | `database.js`、`catalog.js`、`module_state.js`、`module_validation.js`、`snapshots.js` |
| `src/archive/` | 官方采集数据转换和导入校验 | `official_import.js` |
| `src/admin/` | 管理操作、审计、导入/回档，以及管理端OIDC会话 | `admin.js`、`admin_auth.js` |
| `src/auth/` | 游戏账号密码、访问/续期凭据、禁用和撤销 | `game_auth.js` |
| `src/observability/` | 未实现协议的脱敏摘要与累计诊断 | `protocol_diagnostics.js` |
| `src/game/travel/` | 明信片图层生成、旅行路线/道具倾向与兼容模板 | `postcard_generator.js`、`travel_policy.js`、`travel_data.js` |
| `src/game/activities/` | 动态照片、扭蛋、许愿池、贺卡/蛋糕、探索和周末挑选 | `activities.js`、`cards.js`、`exploration.js` |
| `src/game/creative/` | 绘画聚会、手作、不倒翁、庭院物件、花盆与插花 | `creative.js`、`decoration.js` |
| `src/game/life/` | 烹饪、故事、赠礼与回信 | `life.js` |
| `src/game/progression/` | 称号、双百科、日历任务、年报与美好瞬间 | `progression.js`、`daily.js` |
| `src/game/economy/` | 库存/槽位与商店策略、礼包展开、天气昼夜及基础行为 | `economy_policy.js`、`game_data.js`、`gifts.js`、`world.js` |
| `src/game/furniture/` | 家具工作台、配方近似、制作/摆放和商人规则 | `furniture.js`、`furniture_policy.js` |
| `src/game/neighbors/` | 邻居到访、喂食、离场回礼 | `neighbors.js` |
| `src/game/raffle/` | 五券抽奖、待兑颜色和兑奖结算 | `gameplay.js` |

业务状态写入账号游戏表或 `game_module_state`，由统一数据库事务、导入校验和快照机制保护。认证会话、管理审计及未实现日志属于服务管理数据，不随账号游戏快照回档。HTTP路由和协议回包留在应用层，业务模块返回响应与事件，由应用先回session、再推送完整状态，兼容客户端成功回调中的本地修改。

## 管理前端、测试与开发工具

| 目录 | 内容与约定 |
| --- | --- |
| `admin-ui/src/` | Svelte管理台、账号/公告管理、同源API客户端与light/dark/system主题，独立构建为管理Docker镜像 |
| `admin-ui/test/` | 前端API与辅助逻辑测试；命令 `npm --prefix admin-ui test` |
| `tests/` | 服务端、协议、模块、导入/回档与认证回归，使用 `*_test.js` 命名 |
| `tools/android/` | APK准备/原生登录构建和 `NativeLoginActivity.java` |
| `tools/android/patches/` | 序列化追加进客户端的运行补丁；QA钩子只用于显式测试包 |
| `tools/official/` | 官方设备备份、采集钩子准备和资源整理；输入/产物留在忽略目录 |
| `tools/qa/` | adb原生协议队列、smoke和设备检查；设备测试需对应QA客户端 |
| `tools/resources/` | 热更新脚本资源补丁等离线资源工具 |
| `deploy/` | k8s清单、管理反代配置、部署辅助脚本 |
| `docs/` | 协议依据、近似策略、部署与验收记录 |

## 从根目录运行

```powershell
npm start
npm run start:admin
npm test
node --test tests/postcard_generator_test.js
npm --prefix admin-ui test
npm run admin:build
```

上面两个启动命令是不同启动方式，分别启动一次即可；不要同时占用相同端口。单测中的真实APK资源检查依赖本机素材，缺少时明确跳过；不能据此声称原客户端验收完成。

APK开发脚本现在有稳定npm别名，也可以直接调用新路径：

```powershell
npm run apk:prepare -- exports/dog-apk-build/decoded --check
npm run apk:native -- exports/dog-apk-build/decoded
node tools/android/build_local_client.js exports/dog-apk-build/decoded --check
node tools/android/build_native_login.js exports/dog-apk-build/decoded
```

`--check` 是准备脚本的只读检查，不能代替对新的官方APK解包目录执行实际准备；原生构建会写入选定解包目录，之后还要apktool构建与原签名签署。完整参数、依赖和发布包/QA包边界见 [原生登录说明](native-login.md)。

设备队列检查示例：

```powershell
node tools/qa/device_probe.js exports/device-tests/actions.json --check
```

先准备自己的动作文件；去掉 `--check` 后才会通过adb执行。官方数据转换示例：

```powershell
node src/archive/official_import.js <capture.json> <target.sqlite>
```

导入器拒绝覆盖已有目标账号；不要把生产数据库当作检查用输出文件。

## 数据、资源与产物

- `data/` 保存运行中的本地SQLite、管理密钥与机器覆盖配置；默认位置由 `src/paths.js` 锚定仓库根目录。部署时使用 `/data` 持久卷。
- `exports/` 保存用户提供的资源、官方备份、分析证据、APK、签名私钥、镜像与设备QA产物，均不随源码提交。
- 游戏素材也可从相邻官方APK解包目录读取，或用 `FROG_ASSETS` 显式指定。目录移动没有把素材嵌入业务源码。
- 根目录仍有 `package.json`、锁文件、Dockerfile、README等项目配置；个别已存在的本地 `Picture.json/resources.json` 属于忽略的分析资源，不是新的运行业务模块。

历史协议文档中的官方APK路径、资源哈希、REA Evidence和UTF-16偏移保持原样；它们描述对应历史输入，不随本次源码目录调整重新编号。
