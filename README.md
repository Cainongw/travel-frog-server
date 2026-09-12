# Travel Frog private server (minimal)

This is a dependency-free local WebSocket server for protocol development. It accepts the built-in TestChannel guest login and returns minimal game state plus postcard data.

Run:

```powershell
node .\server.js
```

For a MuMu emulator, forward the port before starting the modified client:

```powershell
& 'C:\Program Files\Netease\MuMu\nx_main\adb.exe' reverse tcp:8080 tcp:8080
```

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

Replace the sample array with exported account records when they become available. A different file can be selected with the `FROG_DATA` environment variable.
