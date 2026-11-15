# Travel Frog local archive server

This Node.js server provides local gameplay and a SQLite-backed personal archive for the China edition of Travel Frog. The Svelte 5 management UI is built with Vite; optional OAuth/OIDC uses openid-client.

v0.9 增加 Authentik/OIDC 管理登录、游戏账号密码登录、Docker 和 k8s Service 部署，以及“旅行青蛙·狗狗特供版”构建参数。[部署与登录配置](docs/deployment.md)；后续逐项完善见 [复刻路线待办](docs/replication-roadmap.md)。OAuth 使用 `openid-client`，其余游戏服务采用 Node 内置库。

## Svelte 管理台（v0.9）

在 `private_server` 目录运行（完整构建建议 Node.js 22.12+）：

```powershell
npm run admin:install
npm run admin:build
npm run start:admin
```

打开 `http://127.0.0.1:8080/admin/`。首次启动会在 `data/admin.token` 生成随机管理密钥；在本机读取后粘贴到登录框：

```powershell
Get-Content .\data\admin.token
```

密钥文件、SQLite 和构建产物均不提交到 Git。网页只在内存中保存密钥，刷新后需重新输入。

设备采集脚本 `device_backup.js` / `prepare_official_capture.js` 要求用 `FROG_DEVICE` 指定 adb 序列号，可用 `FROG_ADB` 指定 adb 路径。构建本地客户端的 `build_local_client.js` 用 `FROG_ACCOUNT` 指定私服账号（默认为 `guest`）；构建前需准备脚本中指定的本地 APK 解包及热更新资源目录。个人备份和资源不随源码发布。

管理台支持账号搜索/创建、在线状态、角色名/草/券修改、天气、笔记解锁、访客离场、明信片预览和下发、奖励邮件、相册与库存查看、JSON 导入导出、审计记录与导入前自动备份下载。导入替换前必须确认目标账号；替换前的快照和操作记录与业务修改在同一 SQLite 事务内提交。发送请求带幂等编号，网络失败重试不会重复发奖。

新增“庭院与制造”：查看家具目录及材料需求、补寄缺少的图纸/材料/一种可用工具、操作 10 槽工作台、查询或提前完成制作、摆放已有家具、向家具商人购买物品、安排邻居来访/离场。庭院查询不会创建访客或启动制作。图纸与工具可复用，特殊材料移入工作台后从库存移出，开工后工作台锁定。

### 手动存档快照与回档

在管理台选择账号，进入“存档管理 → 存档快照”：

1. 可填快照名称，点击“创建快照”。先保存当前游戏数据；官方保全账号随后自动解除只读，启用私服已实现的玩法，重新进入游戏即可测试。
2. 列表显示时间、角色、草/券余额及图片/库存/笔记数量，选择需要回到的快照。
3. 输入该账号标识并勾选确认后，点击“确认回档”。回档前会自动创建一份“回档前保护”快照，选它回档即可撤销这次恢复。

当前只支持手动操作，没有定时任务、自动清理或删除功能。普通账号和官方导入账号均支持。快照保存在同一 SQLite 文件的 `admin_snapshots` 表中，覆盖账号对应的全部游戏数据表（包含官方原始协议、明信片半像素坐标、背包、旅行/制作/邻居/抽奖状态和计数器）。它不包含 APK、图片素材、服务配置、管理密钥、其他账号或管理审计历史；仍应单独备份数据库文件和素材。

恢复前校验 SHA-256、账号和表结构；保护快照、恢复和审计记录在一个事务中完成，失败全部撤回。账号的在线游戏会收到重载通知并断开，需重新进入；旧连接不能继续写入。快照中的绝对时间原样保留，重新登录后已到期的旅行/制作仍按现有玩法结算。原有审计记录、幂等请求记录和快照列表不会随回档消失。

官方账号的原始采集数据始终保留，启用后由 SQLite 中的当前状态驱动相册、物品、旅行、邮件、抽奖、家具和邻居等已有玩法。没有本地计时记录的官方旅行/聚会状态会切回在家，不补发奖励；这些转换不改动原始采集数据和已保存的快照。回档到旧的只读快照时也会应用此转换，保持可测试状态。之前已经创建快照的账号，可点击顶部“已有快照，启用玩法”。未实现的活动仍只能展示已有记录，其操作会记入下述日志。

API（均要求 Bearer 管理密钥，POST 另带 `Idempotency-Key`）：

- `GET /api/admin/snapshots?account=...`：返回 `{snapshots,next_cursor}`，每页最多 100 条，继续翻页传 `before=next_cursor`。
- `POST /api/admin/snapshot-create?account=...`，JSON：`{"label":"出发前"}`（名称可空，最多 100 字符）。
- `POST /api/admin/snapshot-restore?account=...`，JSON：`{"snapshot_id":1,"confirm_account":"对应账号"}`；返回恢复快照与保护快照编号。
- `POST /api/admin/archive-activate?account=...`，JSON：`{}`；校验已有快照后解除只读，不需要重复创建快照。

快照只接受恢复服务器已经保存的记录，不通过此入口上传任意 SQL 或快照文件；JSON 存档导入导出仍使用原入口。

### 未实现功能日志

测试时，客户端发送到服务器的未实现协议会返回失败，并显示“暂未支持此功能”的提示；同一连接的同一协议提示间隔至少 30 秒。仅能读取原始官方记录的协议仍返回这些记录，但标为“仅快照读取”，不表示玩法已经实现。

在“操作记录 → 未实现功能日志”查看；点击管理台“刷新”获取最新记录。日志按账号、协议和原因累计次数，保存首次/最近触发时间及最近参数摘要，并同步输出到服务器控制台的 `[unsupported]` 行。参数保留数字编号和结构，文本与凭据脱敏。日志保存在 SQLite 的 `admin_unsupported_calls` 表，服务器重启和账号回档都不会清除。只在客户端本地发生、没有发送网络请求的点击无法由服务器发现。

`GET /api/admin/unsupported?account=...`（Bearer 管理密钥）返回 `{calls}`，按最近触发时间展示最多 200 类记录；原因包括 `unimplemented`、`snapshot_read_only` 和 `archive_readonly`。这些日志属于服务器管理数据，不随账号 JSON 导出迁移。

### 家具和邻居怎么用

旅行商人“嘟嘟”支持已有工具、材料和图纸商品的浏览及购买；商品列表包含客户端显示图片/说明所需的物品编号，购买后同步余额、库存和余量。修复过旧服务漏传物品编号导致点击商人报错的问题，更新服务后需重新进入游戏刷新列表。

1. 在“庭院与制造”选择家具，点击“寄出制造补给”，再在游戏里领取邮件。
2. 工作台 1–5 槽放任意一种家具工具，6–10 槽放对应特殊材料；松木和图纸留在仓库。
3. 青蛙在家且条件满足时，在线定时推进会自动开工；也可在管理台“检查制造进度”。默认 60 秒，到期后加入拥有列表，再选择摆放。服务器停机不重置已开始任务的期限，下次游戏同步补结算。
4. 乌龟/猫头鹰/松鼠是 `guest.*` 邻居，独立于 `visit.*` 省份串门。客户端点击邻居用特产招待；离场后回礼进入邮箱，领取才增加余额。省份访客在场时暂不生成邻居。

当前支持 218 个离线制作配方、68 个家具商店条目和 27 件初始家具。APK 没有提供完整的服务端配方、耗时和回礼概率；本项目采用明示的离线规则，并非官方算法复原。规则及静态证据见 [家具协议](docs/furniture-protocol.md)、[邻居协议](docs/neighbors-protocol.md)、[REA 分析记录](docs/rea-evidence.md)。

默认从相邻目录 `../旅行青蛙·中国之旅/assets/game/resource/China/` 读取 `eab/config.eab` 和 `images/Picture/`。也可以设置 `FROG_ASSETS` 指向这份目录。素材不会复制进仓库；缺少素材时管理台仍可管理档案，但明信片校验/预览、物品目录和抽奖不可用。

明信片可以使用 5 个模板及 4 种同行组合，也可编辑 APK 已有资源的图层 JSON。预览使用与客户端一致的 500×350、左上角坐标绘制。模板背景布局是本地近似，并非复原的官方生成算法。发送后保存到待收相册并生成 `type=11` 邮件；在线客户端实时收到推送，离线客户端下次同步领取。打开邮件会推送完整待收相册，可能连续展示多张未保存明信片。外部图片上传尚未实现。

### 远程访问

```powershell
$env:FROG_HOST = '0.0.0.0'
npm run start:admin
```

其他设备访问 `http://服务器局域网IP:8080/admin/`，输入同一管理密钥。新管理接口和旧 `/api/*` 接口都会校验 Bearer 密钥；旧写入接口在管理模式下关闭，统一走有审计的新接口。不要把密钥放在 URL。跨不可信网络应使用 HTTPS 反向代理或 SSH 隧道。

游戏 WebSocket 默认只接受回环地址，ADB reverse 仍可用。管理密钥只保护管理接口，不是官方账号认证。如果要让可信局域网里的游戏客户端直接连接，显式设置 `FROG_ALLOW_REMOTE_GAME=1`；TestChannel 使用本地账号标识，不应将这个入口直接公开到互联网。

开发管理台：先运行后端，再 `npm run admin:dev`；Vite 将 `/api` 代理到本机 8080。管理台与后端生产部署使用同源地址。

如果 Windows 在启动时返回 `listen EACCES ...:8080`，可先用 `netsh interface ipv4 show excludedportrange protocol=tcp` 检查系统保留范围，然后改用可用端口：

```powershell
$env:FROG_PORT = '18080'
npm run start:admin
```

此时管理台地址为 `http://127.0.0.1:18080/admin/`。游戏仍连接设备上的 8080 时，ADB 映射需改为 `adb reverse tcp:8080 tcp:18080`，无需再次修改 APK。

Implemented archive features:

- role name, icon, achievement and client settings;
- postcards, album pagination, recycle bin and gift-box transfers;
- moments, travel notes, stories, achievements and encyclopedia state;
- versioned JSON import and export.

Implemented basic gameplay:

- a persistent 20-plot clover field with two-hour regrowth;
- clover and ticket balances;
- shop purchases with price, limit and prerequisite validation;
- item inventory, bag and desk slots;
- mailbox read/open state and reward settlement;
- persistent season, time-of-day and weather selection.

Implemented travel loop:

- confirming a prepared bag starts a persistent timed trip;
- native `GoTravel` and `BackHome` client events;
- five rotating postcard scenes using artwork bundled with the client;
- solo travel or travel with the gecko, hedgehog or firefly;
- one new postcard, travel note and specialty on every return;
- reusable bag equipment is returned after the food is consumed;
- trips that finish while the client or server is offline settle on the next login.

Implemented visitor flow:

- a native courtyard visitor appears on the first completed synchronization;
- visitor data uses the client's `visit_load`, `visit_open`, `visit_set_carpet` and `visit_set_expire_time` protocols;
- after departure, claiming a first visit's gift records its province; repeat provinces award tickets;
- visitor state, expiry time and acquired provinces persist in SQLite and exports.

Implemented native raffle:

- five tickets per draw, six colors using the weights found in the APK;
- pending color survives restart and must be redeemed before a new draw;
- prize selection is checked against that color; white balls return a ticket;
- duplicate redemption without a pending draw cannot award again;
- rewarded draws require server-issued credits, not just a client flag.

Protocol evidence and remaining limitations are documented in [docs/gameplay-protocol.md](docs/gameplay-protocol.md) and [docs/implementation-status.md](docs/implementation-status.md).

Requires Node.js 22.5 or newer because it uses the built-in `node:sqlite` module.

## Client setup

The game client must use its built-in `TestChannel` and connect to `ws://127.0.0.1:8080`. `patch_runtime.js` applies those two changes to the hot-update `main.min.js` used during development:

```powershell
node .\patch_runtime.js <original-main.min.js> <patched-main.min.js>
```

Back up the original file, replace the matching runtime-cache file on the rooted test device, and then create the adb reverse mapping shown below. The patcher validates its expected source strings and stops instead of modifying an unknown client build.

Run:

```powershell
npm start
```

For a MuMu emulator, forward the port before starting the modified client:

```powershell
& 'C:\Program Files\Netease\MuMu\nx_main\adb.exe' reverse tcp:8080 tcp:8080
```

The archive is stored at `data/travel-frog.sqlite`. Schema migrations run automatically when the server starts. Stop the server before copying that file as a manual backup. SQLite WAL files are managed automatically.

Every new local account receives the sample postcard, 20 ready clover plants, one welcome mail containing 500 clover and a food item, and an initial visitor state. Existing accounts receive the welcome mail, clover plots and visitor tables automatically when the schema migrates.

## Trying a trip

1. Open the welcome mail if its food reward has not been claimed yet.
2. Put a food item in the first bag slot. Optional charms and tools can go in the remaining slots.
3. Confirm the bag in the client. The frog leaves immediately and the native departure notice is shown.
4. Wait for the trip timer. The default is 60 seconds for development.
5. On return, open the new postcard mail and save or discard the postcard normally.

The food is consumed. Items in the other bag slots are returned to inventory when the frog comes home. The server rotates through rooftop, seaside, branch, bamboo-forest and wheat-field postcards, and through the three available companions plus solo travel.

After entering the courtyard, a visitor is available on the house scene. Wait for departure, then tap the gift left in the courtyard. The first visit adds Beijing to the visitor map. Departure defaults to 30 minutes (`FROG_VISIT_SECONDS`); the unclaimed gift remains after departure and server restarts. The management UI can advance the departure for testing.

## Archive API

Without a management token, the legacy endpoints below accept localhost non-browser requests only. With `FROG_ADMIN_TOKEN` configured, all API requests require `Authorization: Bearer <token>` and writes use the audited `/api/admin/*` endpoints. The Svelte UI handles this automatically.

List accounts:

```powershell
Invoke-RestMethod http://127.0.0.1:8080/api/accounts
```

Export one account:

```powershell
Invoke-WebRequest 'http://127.0.0.1:8080/api/export?account=guest370' -OutFile .\guest370.json
```

Import or replace an account from an exported file:

```powershell
Invoke-RestMethod http://127.0.0.1:8080/api/import `
  -Method Post -ContentType application/json -InFile .\guest370.json
```

The export is a versioned JSON document. Version 6 includes furniture ownership/placement, workbench jobs and neighbor visits, in addition to raffle state and postcard ID sequences. Version 1–5 exports remain importable. Management imports validate the target account and catalog references, and save a recoverable pre-import snapshot. These files are local-server saves; they do not extract an original official account from a phone.

Read weather for an account:

```powershell
Invoke-RestMethod 'http://127.0.0.1:8080/api/weather?account=guest370'
```

Set spring night with clear weather:

```powershell
Invoke-RestMethod 'http://127.0.0.1:8080/api/weather?account=guest370' `
  -Method Post -ContentType application/json `
  -Body '{"season":1,"hours_type":2,"weather":0}'
```

The client contains resources for season/time combinations `11` through `44`. Restart the game after changing weather so the matching scene resource group is loaded.

## Configuration

The following environment variables are optional:

- `FROG_HOST`: listening address, default `0.0.0.0`;
- `FROG_PORT`: HTTP and WebSocket port, default `8080`;
- `FROG_DB`: SQLite archive path, default `data/travel-frog.sqlite`;
- `FROG_DATA`: seed postcard JSON path, default `data/postcards.json`.
- `FROG_TRIP_SECONDS`: trip duration in seconds, default `60` and minimum `1`.
- `FROG_VISIT_SECONDS`: visitor availability duration in seconds, default `1800` and minimum `60`.
- `FROG_CRAFT_SECONDS`: local furniture crafting duration, default `60`;
- `FROG_NEIGHBOR_SECONDS`: neighbor stay duration, default `1800`;
- `FROG_NEIGHBOR_COOLDOWN`: interval after a neighbor leaves, default `21600`;
- `FROG_ADMIN_TOKEN`: management Bearer token, at least 24 characters; `start:admin` generates one when omitted;
- `FROG_ASSETS`: extracted APK `resource/China` directory;
- `FROG_ALLOW_REMOTE_GAME`: set to `1` to allow non-loopback TestChannel WebSockets.

The authenticated management API supports remote access. The game and management entry points use separate access checks.

## Seed postcard

Postcards are loaded from `data/postcards.json`. Each record uses the client format:

```json
{
  "id": 1,
  "pic_id": 100,
  "layers": [{ "layer": [1, 0, 0] }],
  "for_ads": false,
  "visit": false
}
```

`data/postcards.json` seeds newly created accounts only. Existing accounts are read from SQLite. Replace the sample array with exported records before creating an account, or use the archive import API for existing accounts. A different seed file can be selected with `FROG_DATA`; a different SQLite file can be selected with `FROG_DB`.

Run the integration test:

```powershell
npm test
```

Tests use isolated servers and temporary SQLite databases. They cover gameplay, offline/restart settlement, furniture crafting and placement, neighbor feeding/reward mail, visitor gifts, raffle rewards, management authentication, online/offline postcard delivery, validation, idempotency, auditing and restore backups. Management API tests generate their own minimal EAB/PNG fixtures; real APK checks skip explicitly when the local assets are absent. UI tests: `npm --prefix admin-ui test`; production build: `npm run admin:build`. Browser verification used a separate test account/database for workbench placement, starting/completing a job, placing the finished furniture and arranging a neighbor. These checks do not substitute for Android-client visual verification.

## Current limits

Travel probabilities, food/tool effects, destination unlock requirements, furniture recipes and neighbor rewards are intentionally simplified. Plants, courtyard specialty objects (tumbler/compost/pocket/flowerpot), story gift progression, historical activities and the separate `lottery_*` activity are not implemented yet (the native `item_gacha` raffle is implemented). Ads, payments, social sharing, push, official accounts and anti-addiction services remain out of scope for the local archive server.
