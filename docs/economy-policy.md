# 槽位、商店、省份访客与天气辅助策略

`src/game/economy/economy_policy.js` 是不读写数据库的辅助模块，供持久层整合。它不会自行扣款、返还溢出库存或更改既有角色；调用方必须在账号事务里提交变化。

## 直接确认的客户端字段

本机热更新主脚本 `ItemModel` 初始化背包为四格、桌面为八格。背包 UI 的四个选择类型为 `[LunchBox,Amulet,Tools,Tools]`，桌面为 `[LunchBox,LunchBox,Amulet,Amulet,Tools,Tools,Tools,Tools]`；数值分别为 0、1、2。`allowsSlot(kind,pos,itemId)` 的 pos 为协议使用的 1 起始位置。`normalizedSlots` 将输入整理成对应长度，同时列出 `overflow`，让调用方将不合法/多余槽位物品返还库存，而不是悄悄删除。

`shopData_json` 提供完整商品 id、itemId、price、limit、before_buy、隐藏规则和排序，替代旧版固定 64 行表。`before_buy:['shop','22']` 表示先购买商品 22。`Item.own_num` 是客户端对非消耗品检查的总持有数量，包含背包/桌面，不能只看仓库。`checkPurchase` 只返回可执行计划；其成功不等于已事务结算。

相册 UI 每页 6 张；商品说明与扩容提示明确每个 9000 增加 1 页。9001 为动态相框、9002 为照片存储开启物，7000/7001 开启手作/绘画相关入口。`specialEffects` 返回这些语义，活动的真实工作流仍须活动模块处理，不能把发一个物品当作活动已实现。

## 容量处理的证据边界

客户端定义 `ALBUM_MAX=60`，但当前主脚本没有引用这一常量。真实捕获的账号相册有 186 张，9000 库存仅 1，因此不能直接对保全账号强制 `60+6×扩容数`，否则会使现有存档不可用。默认 `albumBase=60` 仅为新账号的可配置近似；`inferAlbumBase(originalCount,originalExpansions)` 可从原始保全计数取一个不小于原记录的基准，调用方应持久化该基准，或在 `albumCapacity` 显式提供 `preservedCount`。原官方基础容量与特殊活动扩容机制仍待更多操作样本核实。

## 省份访客

`visitors_json.provinceList` 含完整省份名、花朵资料、`OtherGiftID` 和 `CountFloor/CountUpper`，不再需要固定七个省份。`provinceVisitor({now,durationSeconds,acquired})` 从已配置省份抽取访客，返回客户端 `visitor` 结构；复访礼物的物品编号与数量范围来自配置。食物动作只从 `actionList` 中当前物品配置确实存在的食物选择，避免发无动画的 ID。

未收集省份以 2 倍权重出现、三种同行伙伴随机选择、城市用省份名作为占位，这些是明确本地近似。官方玩家来源、城市分布、社交身份与到访概率并未由配置恢复。离场礼物领取、首次花朵记账、冷却持久化仍由数据库实现。

## 昼夜与天气

客户端枚举可确认：春夏秋冬 1–4；day/evening/night/late_night 1–4；sunny/cloudy/light_rain/heavy_rain/foggy/frost/windy/light_snow/heavy_snow 1–9。`weatherAt(epochSeconds)` 默认 UTC+8，按月份取季节、按当地时刻取时段。具体季节交界及 6/17/19/24 点时段边界为本地近似。

天气按三小时区块和固定 seed 选取，防止每次请求重新随机；冬季允许霜/雪，其他季节使用晴、云、雨、雾、风。权重是可见的本地配置逻辑，没有接入真实气象服务。管理员手动覆盖天气时，调用方应继续保留覆盖模式，不能被自动天气查询悄悄覆盖。

## 接入示例与测试

```js
const {EconomyPolicy}=require('./src/game/economy/economy_policy');
const policy=new EconomyPolicy({config:catalog.config,catalog});
policy.shop; // Map<shopId,{id,itemId,price,limit,requires,...}>
policy.checkPurchase(shopId,{clover,inventory,bag,desk,purchases});
policy.specialEffects(itemId,count);
policy.provinceVisitor({now:unixSeconds,durationSeconds:1800,acquired});
policy.weatherAt(unixSeconds,{offsetMinutes:480,seed:'my-world'});
```

`node --test tests/economy_policy_test.js` 5 项测试通过，覆盖精确槽位、溢出返还计划、前置与装备持有量限购、扩容/保全计数、配置省份礼物、时区和稳定天气；真实配置测试确认商品多于旧 64 条、省份多于 30 个。该结果只证明辅助策略，需要核心数据库、协议和客户端端到端测试后才可完成路线图对应项。
