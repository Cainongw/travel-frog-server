# Travel Frog local archive server

This dependency-free Node.js server provides a local login and SQLite-backed personal archive for the China edition of Travel Frog.

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

Every new local account receives the sample postcard, 20 ready clover plants, and one welcome mail containing 500 clover and a food item. Existing accounts receive the welcome mail and clover plots once when upgrading to schema v2.

## Archive API

Management endpoints accept localhost connections only.

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

The export is a versioned JSON document. Version 2 includes inventory, bag/desk equipment, shop purchases, clover plots, all mail records and weather. It can be inspected or edited before importing. Use a different `account.account` value to import it as a separate local account. Version 1 exports remain importable.

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

Archive APIs are restricted to loopback clients even when the WebSocket server listens on all interfaces.

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

The integration test starts an isolated server and temporary SQLite database. It covers login, initial synchronization, album/recycle behavior, mail rewards, shopping, inventory, bag placement, clover harvesting, weather, and versioned export/import.

## Current limits

The offline travel loop, visitors, furniture crafting, lottery, plants and historical activities are not implemented yet. Ads, payments, social sharing, push, official accounts and anti-addiction services are intentionally out of scope for the local archive server.
