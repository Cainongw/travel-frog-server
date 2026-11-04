# Travel Frog local archive server

This Node.js server provides a local login and SQLite-backed personal archive for the China edition of Travel Frog. The server uses Node built-ins; the optional Svelte 5 management UI is built with Vite.

## Svelte 管理台（v0.6）

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

管理台支持账号搜索/创建、在线状态、角色名/草/券修改、天气、笔记解锁、访客离场、明信片预览和下发、奖励邮件、相册与库存查看、JSON 导入导出、审计记录与导入前自动备份下载。导入替换前必须确认目标账号；替换前的快照和操作记录与业务修改在同一 SQLite 事务内提交。发送请求带幂等编号，网络失败重试不会重复发奖。

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

The export is a versioned JSON document. Version 5 adds persistent raffle state, a monotonically increasing postcard ID and visitor rotation count. Version 1–4 exports remain importable. Management imports validate the target account and catalog references, and save a recoverable pre-import snapshot. These files are local-server saves; they do not extract an original official account from a phone.

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

Tests use isolated servers and temporary SQLite databases. They cover gameplay, offline/restart settlement, visitor gifts, raffle rewards, management authentication, online/offline postcard delivery, validation, idempotency, auditing and restore backups. Management API tests generate their own minimal EAB/PNG fixtures; real APK checks skip explicitly when the local assets are absent. UI transport tests: `npm --prefix admin-ui test`; production build: `npm run admin:build`.

## Current limits

Travel probabilities, food/tool effects and destination unlock requirements are intentionally simplified. Furniture crafting, plants, historical activities and the separate `lottery_*` activity are not implemented yet (the native `item_gacha` raffle is implemented). Ads, payments, social sharing, push, official accounts and anti-addiction services remain out of scope for the local archive server.
