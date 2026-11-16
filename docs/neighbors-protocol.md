# Neighbors: client observations and local implementation

This document covers `guest.*` (困困 the turtle, 胖胖 the owl, 跳跳 the squirrel).
It does **not** describe `visit.*`, which is the separate province-visitor and flower collection system.

## Evidence boundary

The source is the extracted APK supplied in this workspace:

- `旅行青蛙·中国之旅/assets/game/js/main.min.js`
  - SHA-256: `8c60c9b55c73758035c64bfdbd1bf56348ebad5c61b002ad12683fbd2064cb0d`
- `旅行青蛙·中国之旅/assets/game/resource/China/eab/config.eab`
  - SHA-256: `c15aaa92e20797af01cedcc4eea2016f108aa290dc072fae089ad2062cc263af`

These are ordinary shell/Node static observations, **not REA Evidence records**.
The parent investigation handles the unavailable REA connection/CLI diagnosis;
this sub-investigation did not install tools, change MCP configuration or execute APK JavaScript.
EAB tables were read using the project's `catalog.readBundle` data decoder.
No official server traffic or running Android client was observed for this feature.

Offsets below are zero-based in the exact file above. UTF-16 offsets are
JavaScript string indices; byte offsets are UTF-8 file offsets.

| Anchor in main.min.js | UTF-16 offset | Byte offset | Observation |
| --- | ---: | ---: | --- |
| `var GuestData` | 189911 | 192531 | `id`, `confirmed`, `served`, `expire_time`, `pos`; absent neighbor `id=-1` |
| `prototype.sendGuestConfirmed` | 192954 | 195622 | confirm sends species `id` |
| `prototype.sendGuestServed` | 193147 | 195815 | feed sends species `id`, specialty `item_id`; local `served` becomes true |
| `prototype.guest_load=function` | 201340 | 204062 | replaces GuestData, but does not dispatch a redraw event |
| `guest_load:[` | 377062 | 421991 | protocol argument lists, including no arguments for `guest_finish` |
| `prototype.consumeHouseItem=function` | 138472 | 140426 | checks inventory availability only; server must send absolute remaining item count |
| `prototype.getFriendTaste` | 441558 | 487713 | finds specialty by position in `SpecialtyDB.list()`, then reads neighbor `taste[position]` |
| `prototype.getGameplayList` | 114456 | 116246 | a still-present neighbor short-circuits selection before province visitor |
| `prototype.checkGameplay` | 864195 | 914764 | clears/rebuilds visitor visuals; may send `guest_finish` for an overdue hidden neighbor |
| `prototype.checkFriend` | 867561 | 918204 | ids `0,1,2` map to `wugui`, `maotouying3`, `songshu`; sends departure time only when zero |
| `friendFeedBack=function` | 870660 | 921403 | taste thresholds `80`, `60`, `20` drive the four client responses |
| `switch(t.sender)` in mail display | 787029 | 837220 | gift-mail sender ids `0,1,2` select turtle/owl/squirrel icons |

The `RoleEventType.loadRole` handler at UTF-16 offset `832171` calls `view.reset()`,
which calls `checkGameplay()` at `872084`. For an online neighbor update, send
`guest_load` followed by the current `client_load_role` snapshot. This redraws
the courtyard using existing client behavior. `notify_new_event` alone is not
evidence that the neighbor art is redrawn.

## Config observations

`Character_json.data` contains three records with id, name and taste arrays:
`0/困困`, `1/胖胖`, `2/跳跳`. `Specialty_json` supplies the specialty-list order.
The tail of `Character_json.rowItemId` differs from the order of `Specialty_json`;
the implementation deliberately follows `getFriendTaste`, which uses the latter.
Do not use a specialty's item id directly as its taste-array index.

`gameplay_json` declares:

| Gameplay | DurationFloor / Upper (minutes) | OverdueContinue | Sort |
| --- | --- | --- | --- |
| 串门 | 30 / 30 | 0 | 1 |
| 邻居 | 30 / 30 | 1 | 2 |

An active, not-yet-departed neighbor wins the early return in `getGameplayList`,
even though province visitors have the smaller Sort. Avoid scheduling two live
visitors simultaneously. An already-departed province visitor may retain an
unclaimed gift while a neighbor is present; the client gift icon is independent.

## Local policy, not an official-server reconstruction

The official arrival algorithm, cooldown enforcement and reward distribution
were not recovered. The offline server chooses these explicit rules:

- First visit is `0` for onboarding; later identities are randomly sampled from `0,1,2`, rather than rotated. Default stay 1800 seconds, cooldown 21600 seconds. After cooldown, evaluate a 10% arrival chance once per 1800 seconds; a failed check persists its next-check time, so repeated login/polling cannot reroll every second. These values also appear in client `FRIEND_VISIT_RNDPER/RNDSEC/COOL`, but the server's original scheduler has not been recovered.
- Do not generate a neighbor while a province visitor is still present.
- Only owned items of type `3` present in Specialty_json with a valid taste entry can be fed.
- Consume one item transactionally and permit only one feeding per visit.
- No feeding means no gift. A fed neighbor deposits a type `3` gift mail on departure.
- Taste `>=80`: 80 clover + 1 ticket; `>=60`: 50 clover; `>=20`: 30 clover; otherwise 20 clover.
- `rewardTable` can configure feeling thresholds and clover/ticket ranges. A stable hash of account and committed visit fields selects within those ranges, keeping the same reward through retries and process restarts. Default point ranges retain the amounts above; reward ranges are local policy, not confirmed official distributions.
- Mail rewards are awarded only by the existing `mail_open` settlement, not at departure.
- A late login settles one outstanding visit and starts its cooldown at settlement time.
  It does not simulate years of missed visits or issue accumulated historical gifts.

The above amounts are project choices. Only the taste values, response thresholds,
mail rendering and wire fields are supported by the listed static client evidence.

The enhanced `NeighborService` additionally accepts `random`, `arrivalChance`, `checkSeconds`, `firstNeighborId` (`null` randomizes even the first visit), and `rewardTable:[{feeling,clover:[min,max],ticket:[min,max]}]`. Tests inject a random source and arrivalChance 1 for deterministic business flows, with separate tests for missed-check persistence and stable configurable rewards. The existing schema stores all authoritative arrival/departure times; no new account-table columns were introduced for this change.

## Module integration

`neighbors.js` exports:

- `migrateNeighbors(database)`: create `neighbor_state`; does not set `user_version`.
- `getNeighborState(database, account)`: read-only raw snapshot, with defaults if no row.
- `importNeighborState(database, account, state)`: validate and upsert inside caller's account-import transaction.
- `guestProtocol(state)`: select only the five wire fields.
- `NeighborService(database, catalog, options)`.

Required catalog fields:

```js
{
  items: Object.values(config.Item_json),
  neighbors: config.Character_json.data,
  specialties: Object.values(config.Specialty_json)
}
```

Options: `{ durationSeconds: 1800, cooldownSeconds: 21600 }`.
When these catalog records are unavailable, new arrivals are disabled explicitly.
Existing fed visits can still finish and deposit their saved-taste reward.

Service methods accept an optional final Unix-seconds `now` for deterministic tests:

| Method | Purpose |
| --- | --- |
| `sync(account, now)` | Settle an overdue visit, then generate one when eligible |
| `confirm(account, id, now)` | Mark the active species as acknowledged; replay is harmless |
| `serve(account, id, itemId, now)` | Validate, consume one specialty, save taste; returns `itemChanges` |
| `setExpire(account, time, now)` | Initialize a legacy zero departure time, never overwrite a set deadline |
| `finish(account, now)` | Only settle an already-due visit; no forced early reward |
| `forceArrive(account, now)` | Admin: settle an expired visit first, preserve its returned mail, bypass cooldown, never overwrite an active visit or displace a live province visitor |
| `forceDepart(account, now)` | Admin: depart and settle the current neighbor without creating a replacement |

Results have `{ ok, guest, mail, changed }`, with optional `reason`, `replayed`,
`feeling` and `itemChanges`. `guest` is always the wire-safe five-field object.
`mail` is null or the full MailInfo for `notify_new_mail`. Root integration should
push any returned mail even if `forceArrive` cannot spawn after settling a visit.

At initial synchronization, call sync before loading the mail list, then send
its `guest`; the normal `mail_load` snapshot already includes any settled mail.
On online timer transitions, push `guest_load`, `client_load_role`, and any new
mail. After `guest_serve`, push absolute `item_update` records (including zero).
On failure, restore authoritative `guest_load` state rather than leaving the
client's optimistic `served=true` permanently visible.

Store the raw state in schema-6 exports as `neighbors`:

```json
{
  "id": 0,
  "confirmed": true,
  "served": true,
  "expire_time": 1800000060,
  "pos": 0,
  "food_item": 3001,
  "feeling": 99,
  "next_visit_at": 0,
  "visit_count": 1
}
```

Missing old-format `neighbors` becomes an absent neighbor. Account replacement
must replace this state too. Foreign keys support account deletion. Snapshot
validation checks flags, ranges and active/absent consistency; the manager can
add catalog-based checks for imported food ids.

Because the wire `id` identifies a species, not a unique visit, a delayed request
from three visits ago cannot be distinguished from a new request after that same
species returns. The served flag prevents replay within one visit; universal
cross-visit replay detection is not claimed.

## Verification

`node --test neighbors_test.js` uses temporary or in-memory SQLite. Tests cover
wire shape, wrong species, item type/ownership, specialty-order taste lookup,
single consumption, deadlines, province concurrency, mail settlement exactly
once, manual arrival/departure, transaction rollback, offline reopen, import
round-trip and missing catalog. This verifies server behavior, not Android UI
rendering or equivalence to official-server random probabilities.
