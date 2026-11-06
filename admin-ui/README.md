# 青蛙邮局 / Svelte management UI

The management interface uses Svelte 5 and Vite. It communicates with the Node server's authenticated `/api/admin/*` API on the same origin.

## Run

Set a `FROG_ADMIN_TOKEN` of at least 24 characters when starting the server. The UI asks for that token and holds it only in page memory. A refresh or disconnect clears it. Resource previews use authenticated fetch requests; the token never appears in image URLs.

```powershell
npm install
npm run build
```

The built application is served by the Node server at `http://127.0.0.1:8080/admin/`. The build requires Node.js 22.12+ (or a later supported release).

For frontend development, start the Node server on port 8080, then run `npm run dev`. Vite proxies `/api` to that server. The production deployment uses the same server for UI files and API; it does not require a separate frontend service.

For remote access, open `/admin/` on the server's reachable address through HTTPS or an SSH tunnel. The source does not embed a server URL or administration token.

## Functions

- Connect with a management token; find, select and create accounts.
- Inspect balances, travel, inventory, postcards, mail, notes and visitor state.
- Send native postcard templates, choose companions, or edit validated layer JSON. Previews use the same 500 × 350 canvas and layer order as the client.
- Send clover, ticket and item rewards by mail.
- Edit the frog's name and balances, choose weather, unlock notes and end a visitor's stay.
- Manage the courtyard: inspect crafting jobs, prepare the ten workbench slots, settle due jobs or finish a job immediately for testing, buy furniture merchant stock, and place owned furniture.
- Inspect native neighbor visits and feeding state, arrange a visit, or settle a departure.
- Search furniture recipes and send only the missing blueprint, tool and material quantities by mail. Inventory and workbench quantities are counted together. The tool list contains alternatives: any owned tool is sufficient; if none is owned, the parcel includes only the first option. Recipes and craft times use the server's explicit offline approximation.
- Export JSON saves. Imports require a matching account, a typed confirmation and a checked acknowledgement; the server saves a recovery copy first.
- Browse the latest 100 management operations and download recovery snapshots.

The server must have its local APK resource directory configured to provide images, items and notes. The UI does not include or redistribute game artwork. Custom postcard layers reference existing client resources; arbitrary image uploads are not supported.

The courtyard reads `/api/admin/garden?account=…`, which must not create visits or start jobs as a side effect. Workbench slots 1–5 accept furniture tools and slots 6–10 accept special materials. Ordinary crafting resources remain in inventory. Normal job settlement does not advance the clock; only the separately labelled administrator test action finishes a job early.

Import accepts save versions 1–6. Successful management writes refresh account and courtyard state in place so selected slots and furniture remain visible. Changing accounts clears the current import selection and confirmation.

Network failures retain the request's idempotency key so retrying an unchanged operation cannot repeat a reward already processed by the server. The UI does not retry writes automatically.

Run `npm test` to verify the API client's authentication and retry behavior. Run `npm run build` to compile and check Svelte templates.
