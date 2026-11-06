# 家具协议与离线制作规则

## 证据来源与范围

下表是**普通 shell / Node 静态读取证据，不是 REA Evidence，也不是原客户端运行观测**。分析使用仓库旁解压 APK 的两个明确文件，没有执行 APK 脚本，没有修改真实设备或真实 SQLite。

| 文件 | SHA-256 |
| --- | --- |
| `旅行青蛙·中国之旅/assets/game/js/main.min.js` | `8c60c9b55c73758035c64bfdbd1bf56348ebad5c61b002ad12683fbd2064cb0d` |
| `旅行青蛙·中国之旅/assets/game/resource/China/eab/config.eab` | `c15aaa92e20797af01cedcc4eea2016f108aa290dc072fae089ad2062cc263af` |

以下偏移为该 `main.min.js` 解码成 JavaScript 字符串后的 **UTF-16 code-unit 偏移**，不是字节偏移。可使用 `fs.readFileSync(path,'utf8').slice(offset,offset+length)` 定位；更换版本后须先核验文件摘要。

| 位置 | UTF-16 偏移 | 观测到的片段或行为 |
| --- | ---: | --- |
| `FurnitureModel` | 102288 | 初始化 `shop,mood,bench_lock,bench,put_fur,has_fur,mate_list,replace_fur` |
| `getOwnedFurnitures` | 106668 | `return this.serverData?this.serverData.has_fur:void 0` |
| `getBenchTools` | 107160 | `this.serverData.bench.slice(0,5)` |
| `getBenchItems` | 107830 | `this.serverData.bench.slice(5)` |
| `replaceFurniture` | 108740 | 按家具 `type` 替换摆放；`code=1` 移除待替换标记，`code=0` 添加待替换标记，`code=-1` 不应用 |
| `getMateList` | 113197 | 返回 `mate_list`；工作台展示材料时按重复 ID 数量从持有数扣掉 |
| `isLockBench` | 113330 | `return 1==this.serverData.bench_lock` |
| 协议表商人购买 | 378733 | `furniture_buy_shop:[["shop_id"],!0]` |
| 协议表放入工作台 | 378769 | `furniture_putin_bench:[["pos","id"],!0]` |
| 协议表取出工作台 | 378809 | `furniture_takeout_bench:[["pos"],!0]` |
| 协议表摆放 | 378846 | `furniture_replace_fur:[["id"],!0]` |
| 工具选择 UI | 609306 | 筛选 `ItemType.FURNITURE_TOOL`，排除工作台已有的相同工具；锁定时不允许修改 |
| 特殊材料选择 UI | 610294 | 筛选 `ItemType.FURNITURE_ITEM`；锁定时不允许修改 |
| `FurnitureFinish` 事件 | 887217 | 将 `evt_id` 解释为家具 ID；查到家具后请求 `furniture_load_furniture` 并弹出获得新家具提示 |
| `FurniturePut` 事件 | 888930 | 展示“小屋好像发生了一点变化”提示 |

在上述单个主脚本内对 `furniture_lock_bench`、`furniture_make`、`furniture_finish` 的精确字符串搜索均为零。观察到的制作锁是服务端下发字段，不应发明原生“锁工作台/制作/收取”请求。它不证明所有平台、其他热更版本或官方服务端均不存在相关内部接口。

## 原生状态与返回值

```json
{
  "shop": {
    "start_time": 100,
    "leave_time": 86500,
    "shop_list": [{ "shop_id": 2001, "num": 99 }]
  },
  "mood": 3,
  "bench_lock": false,
  "bench": [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
  "put_fur": [{ "type": 1, "id": 1001 }],
  "has_fur": [1001],
  "mate_list": [],
  "replace_fur": []
}
```

槽位协议 `pos` 从 1 开始：1–5 是工具（Item type 12），6–10 是特殊材料（type 11）。通用原料（type 10）留在仓库，图纸（type 13）也是独立持有物。

购买/工作台写操作使用 `code=0` 表示成功。摆放协议的成功不是同一种语义：本实现立即摆放，返回 `code=1`，不支持排队等待青蛙换装的 `code=0` 模式；失败返回 `-1`。`put_fur` 按种类至多一件，且必须已经拥有。

新家具完成事件为 `evt_type=21,evt_id=家具ID`；摆放完成事件为 `evt_type=22`。事件保存在现有 `travel_events` 表中，并由 `client.confirm_event` 确认。两种事件的 `evt_value/evt_string/evt_pic` 都为空数组。

客户端回包仍有本地副作用：`furniture_buy_shop` 成功回调会将商店行的 `num` 减一；put/take 成功回调会写本地槽位。因此若要发送完整 `furniture_load_furniture`，应安排在对应 session 回包之后。放材料后由下一次定时推进开启制作，避免在 put 回包前消耗槽位，随后又被客户端回调写回。

## 从资源得到什么，以及没得到什么

`catalog.readBundle` 解码到下列数据。下面的 decoded JSON 摘要来自 `SHA256(JSON.stringify(value))`，只用于复核此次解码值，不替代原始 EAB 摘要。

| 配置 | 条目数 | decoded JSON SHA-256 |
| --- | ---: | --- |
| `furnitureData_json` | 294 | `ef4cfe79bba8036ffd04d5c607ccc658c7d38b49177294c408871366ef248ee2` |
| `furnitureShopData_json` | 170 | `0f3d1f5118d33ce54372de9f4e55d831a3206ca489eddc7143db7fa5e5de4e35` |
| `furnitureCommon_json` | 39 | `852981f01604bf27356905645d77e27a44c7bdd43b11a343fab4c225e048ba0b` |
| `benchData_json` | 300 | `6d1c367210e9f154e91161cd1eac7d0f0bfa1234af10855f03fdd04c1bb78ce6` |

家具配置提供家具 ID、类型、风格、对应图纸 `drawing`、名字和图片资源；例如家具 1101 的图纸是 10301，风格为 2，类型为 1。商店配置提供商品 ID、道具 ID、价格、前置物品、限制数量。工作台配置只列产物 ID 和产物类别；本次读取的这些表中没有完整材料数量、工具组合、制作时长和官方挑选产物算法。

所以，下列规则是**本项目明确制定的离线规则，不是官方规则的反编译结果**：

- 默认拥有并摆放配置中的 27 件 style 1 家具，保证原房间各类型有初始选择；不自动赠送工具、材料或图纸库存。
- style 2–9 分别对应特殊材料 10101–10108；拥有目标的图纸，工作台有任一工具和相应特殊材料，仓库有 1 个松木 10001，且青蛙在家时，可以自动开工。
- 每次消耗 1 个特殊材料和 1 个松木，工具及图纸不消耗，默认耗时 60 秒。按家具 ID 选择第一件尚未拥有的可制作家具。
- 工具槽只是对仓库工具的引用；特殊材料放到工作台时从库存转移，取出时归还。开始制作时消耗槽内特殊材料和库存松木，期间锁定全部工作台槽位。
- 原料已在开工时实际扣除，所以 `mate_list=[]`，避免客户端再减一次预留原料。完成后解锁工作台并加入拥有列表；不自动摆放。
- 制作开始时间与完成时间在数据库中提交，服务器重启不改变期限；到期后再次推进一次性结算。管理员可提前完成当前制作，但不会把服务器时间伪造到未来。
- 商人窗口默认持续一天，到期刷新访问窗口；`limit` 按账号累计购买量限制，`shop_limit` 按该窗口限制，`has_item` 要求持有指定前置物品。无限制行在客户端显示最多 99 个可买数；这不是官方刷新算法。
- 只上架物品 type 10–13 的商店行。礼包、活动食品和非家具特殊物件不假装支持。当前给定资源对应 218 个离线可制作家具、68 个支持的商店条目。

不倒翁、堆肥箱、挂兜、花盆及其制造/收益规则仍不属于这个家具模块，即使 `benchData` 同时含有它们的 ID。

## 服务端接口

```js
const { FurnitureService, migrateFurniture, exportFurnitureState,
  importFurnitureState, validateFurnitureState } = require('./furniture');
const furniture = new FurnitureService(database, catalog, {
  craftSeconds: 60,
  shopSeconds: 86400
});
```

`catalog` 需提供 `items`、`furniture`、`furnitureShop`、`bench` 数组；后三者分别来自上述家具、商店、工作台配置。

- `migrateFurniture(database)`：创建 `furniture_state` 表，适合在数据库迁移阶段调用。
- `getState(account, now?)`：初始化并返回原生状态，可能建立账号家具行或刷新商店窗口；供游戏同步使用。
- `peekState(account, now?)`：纯读投影；未初始化时显示配置默认值，不创建账号或写入家具行。供管理端 GET 使用。
- `put(account, pos, itemId, now?)`、`take(account, pos, now?)`：验证并更新工作台。
- `buy(account, shopId, now?)`：原子扣款、加物品和记录购买限制。
- `replace(account, furnitureId, now?)`：摆放已拥有的家具，同种类替换，不重复发相同摆放事件。
- `advance(account, now?)`：先结算到期制作；没有制作且满足条件时开启一件新制作。单次调用只做其中一个阶段。
- `finish(account, now?)`：管理员专用提前完成；没有当前制作时拒绝，不是新增游戏原生 RPC。
- `getCatalog()`：给管理台提供实际离线配方 `furniture`、支持商店 `shop`、完整家具名称列表 `allFurniture`，避免前端重复推测配方。

操作结果具有 `{ok,code,itemChanges}`；可能包含 `clover`、`changed`、`started`、`completed`、`event`。`itemChanges` 是绝对库存数量。制作任务在 getState 的额外 `job` 字段暴露为：

```json
{
  "furniture_id": 1101,
  "started_at": 100,
  "finish_at": 160,
  "material": [{"item_id":10101,"count":1},{"item_id":10001,"count":1}],
  "tool": [10201]
}
```

账号 JSON 可增加 `furniture: exportFurnitureState(database, account)`。导入在原有事务里调用 `importFurnitureState(database, account, snapshot.furniture, catalog)`，缺失或 null 清除家具模块状态，由下次游戏同步生成默认值。原始存储格式包括 `bench/owned/placed/job/shop_start/shop_end/purchases/shop_bought`；不要把原生 `getState()` 响应直接当成持久层快照。验证会检查十槽结构、分类、重复工具、摆放归属/类型、任务时间和任务物料/工具的配置身份。

## 验证与仍需实机确认的部分

```powershell
node --test furniture_test.js
```

十项隔离 SQLite 测试覆盖槽位分类、材料转移/归还不复制、可复用工具、不满足条件不制作、在外不制作、制作时锁定、到期只结算一次、正确事件编号、摆放回包、商人价格/前置/购买限制、跨重启与导入后离线结算、提前完成、事务失败回滚、非法导入、管理查询不写状态，以及配置临时缺失时不覆写待制作任务、不永久初始化空房间。

尚需真实客户端确认家具页导航、资源加载、工作台锁定提示、制作完成弹窗、所有家具摆放图片及商人库存显示。静态字段核对与本地协议测试不能代替这些运行观测；官方配方、耗时和制作行为仍未恢复。
