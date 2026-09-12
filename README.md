# Travel Frog local archive server

This dependency-free Node.js server provides a local login and SQLite-backed personal archive for the China edition of Travel Frog. It currently supports role settings, postcards, the album recycle bin, gift-box postcards and specialties, moments, travel notes, stories, achievements, and encyclopedia state.

Requires Node.js 22.5 or newer because it uses the built-in `node:sqlite` module.

Run:

```powershell
npm start
```

For a MuMu emulator, forward the port before starting the modified client:

```powershell
& 'C:\Program Files\Netease\MuMu\nx_main\adb.exe' reverse tcp:8080 tcp:8080
```

The archive is stored at `data/travel-frog.sqlite`. Stop the server before copying that file as a manual backup. SQLite WAL files are managed automatically.

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

The export is a versioned JSON document. It can be inspected or edited before importing. Use a different `account.account` value to import it as a separate local account.

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
