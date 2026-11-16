# 绘画聚会、手作与不倒翁

本模块为路线图第 11 项提供可运行的服务端流程。保存、状态推进和奖励结算已通过隔离 SQLite 测试；原生客户端实际交互仍需集成后逐项验证，不能据此勾选“全部实机正常”。

## 证据与边界

复用已有 REA 静态证据 `ev_54b142b4e7d9807890a683466175fa62c7c2902457d3d25867ff5872c41410e6`（本地 `exports/rea-merchant-20261115.json`）。它只分析 `main.min.js`，其他 16 个文件未分析且语义保留达到默认上限。下面的精确字段另外通过普通 Node 静态读取主脚本、`catalog.readBundle` 解码配置和已保存的官方响应核对，不冒称为 REA 运行时证据。

- 主脚本：`exports/dog-apk-build/decoded/assets/game/js/main.min.js`。该本地包带登录补丁；下列 UTF-16 起点在游戏主体未变化时适用：`DrawingModel` 96227、`HandCraftModel` 131502、协议表 `guest_accept_invit` 380280、`DrawView` 582838、`PrayCraftPageView` 762021、`StampCraftPageView` 767684、`Souvenir` 约 1261805。
- 配置：`exports/oneplus-official-20261114-live/assets/eab/config.eab`，包含绘纸、收藏、礼物食品映射、祈愿形体与纸张、印章、拼接木片、不倒翁形体及图层资源。
- 历史官方响应：`exports/oneplus-official-20261114-final/internal/files/jsdata/frog-official-export.json`。`guest_load_drawing` 实际有四格礼物背包、state 4、绘纸/收藏数组；`pray_load_grays` 实际是 `{wishs,boxes,stamps}` 对象；`furniture_load_tumbler` 实际有五数图层数组。

### 客户端确认的确定性规则

| 内容 | 已观察到的客户端行为 |
| --- | --- |
| 绘画状态 | `wait=0, invite=1, accept=2, lock=3, visit=4` |
| 绘画开启 | 持有 `7001` 友情绘本 |
| 接受/拒绝 | `guest_accept_invit` 参数 `is_accept:boolean`；成功 `code=0` |
| 礼物背包 | 四格；`pos` 从 1 开始。第一格由 DrawingCommon.food 映射允许的食品，本版本为 16/15/33；后三格选择 type 3 特产 |
| 准备完成 | `guest_lock_bag` 无参数，同一命令在 accept/lock 之间切换。没有第一格手信时界面不允许完成 |
| 聚会事件 | `PartyGo=23`；`PartyResult=24`，结果 `evt_id=guest`、`evt_value=[page,coll,clover,ticket,...items]` |
| 手作数据 | `pray_load_grays` 须包含 `wishs,stamps,boxes,wish_new,stamp_new`；数组位置允许空对象经客户端转换 |
| 祈愿条目 | 使用 `u_id,id,state,body,paper,content,make_time,stamp,stamp_state,stamp_time`，body/paper 对应配置资源 |
| 印章条目 | 使用 `u_id,id,state,time`，state 为该印章配置支持的阶段 |
| 合成 | 客户端 `ComposeId=5502`，界面检查 type 16、sub_type 1/2/3 的三个木片，本版本为 8501/8502/8503；回包 `item_list` 为物品 ID 数组 |
| 盒子确认 | `pray_confirm_make_box` 清除客户端待展示盒子，不应再次发放库存 |
| 不倒翁 | `furniture_load_tumbler` 为 `{show_index,replace_index,tumbler_list}`；索引从 1 开始，0 不摆放；图层为 `[path_id,x,y,rotation,flip]` |
| 摆放结果 | 客户端 `code=1` 表示立即摆放，`code=0` 表示等待，`code=-1` 不应用 |
| 制作完成事件 | `FurnitureFinish=21`；不倒翁事件的 `evt_value=[5,...每层五个数]`，供原生提示复原层结构 |

## 明示的本地近似规则

这些属于为接近原版效果制定的本地规则，尚未取得足够官方样本验证其概率、配方和时长：

- 持有友情绘本时自动生成邀请，随机选择三位伙伴。默认 6 小时冷却；拒绝归还仍预留的礼物。
- 锁定后默认等 30 秒，在青蛙在家且无旅行任务时出门，聚会持续 30 分钟。原生无参数锁定命令在出门前仍可解锁；参加期间禁止改背包。
- 成功聚会消耗已准备的礼物，优先选择该伙伴尚未取得的绘纸与符合配置前置的收藏，每次 20 草，无固定券。此奖励分布是本地设计，不是官方概率。
- 官方采集里已在参加但没有本地计时记录的聚会，保留原有绘纸、收藏和礼物，恢复到准备阶段，不自动补发历史奖励。
- 手作工具 `7000` 与手工材料 `8000` 在家时自动开工；默认 15 分钟、完成后 5 分钟冷却，祈愿和印章交替。祈愿直接完成到 state 4，从该配置合法 body/paper 组合中挑选，印章在各自合法阶段逐级推进。
- 原料 `8001` 朽木使用同样计时，随机生成一个真实配置的食物/护符/特产/材料/木片，直接入库，并保留盒子提示；确认只清除提示。具体朽木产出表未知。
- 合成每次消耗 8501、8502、8503 各一份，从 1300–1309 木制风格护符中选择一件真实物品。官方产物概率尚未知；重复请求仅能在仍有完整材料时再次制作。
- 不倒翁图鉴 `10401`、工作台任意已有 type 12 工具及一份松木 `10001`，在家时可开工。松木开始时扣除，图鉴和工具复用，默认 30 分钟。真实配方与耗时尚未知。
- 不倒翁优先选择未拥有的真实配置 ID；图层从客户端可用眼睛/装饰资源中生成，坐标和旋转为保守零值，属于合法资源构图近似，不保证与官方随机绘制风格一致。

## 接口与集成

```js
const {CreativeService}=require('./src/game/creative/creative');
const creative=new CreativeService(database,catalog,{clock:()=>Math.floor(Date.now()/1000)});
```

`catalog.config` 为解码后的完整配置，`catalog.items` 为物品定义。状态保存到 `game_module_state` 的 `creative` 行，ModuleState 已由主服务纳入账号导入/导出和快照。

- `commands`：绘画、手作、不倒翁及下述庭院模块请求的 Set。
- `initial(account)`：推进到期任务并返回初始 `{cmd,data}` 数组，含绝对库存/角色更改及三个模块的完整状态。
- `handle(account,cmd,data)`：返回 `{response,events}`，未知命令返回 null。服务应先回 session，再依次发送 `events`，避免客户端成功回调的本地背包/索引更改覆盖新状态。
- `advance(account)`：事务推进，返回 `{changed,events}`。每次最多结算各模块的一次任务，不模拟多年离线收益。
- `isBenchLocked(account)`：不倒翁或其他庭院物件制作任务期间 true。
- `decorateFurnitureState(account,state)`：将不倒翁制作锁与原家具锁合并，供原生 `furniture_load_furniture` 投影使用。

需要主服务先执行 creative 推进；不倒翁任务持有工作台时跳过普通家具 advance，并拒绝普通家具 put/take。任务完成后重推家具锁状态。原始官方协议不能再覆盖这些动态状态；保全只读模式仍由外层守卫控制。

## 已验证

`node --test tests/creative_test.js` 当前通过 16 项：邀请/准备/锁定/解锁/参加/归来完整流程、材料一次性预留与消耗、拒绝归还、真实收藏保留、手作合法字段与延期、木片合成及盒子确认、五数图层不倒翁制作与摆放、失败事务回滚、实际数据库重开和 ModuleState 导入恢复，以及最新私有 APK 配置的所有 36 个不倒翁输出资源合法性。后续庭院与家具策略测试覆盖挂兜上限与重复领取、六槽堆肥、所有 35 个植物真实产物映射、种植阶段/收获、自动物件制作及 353 个可制造家具配置覆盖。

仍须由主流程完成原生页面操作、聚会事件弹窗、手作展示、工作台锁动画与不倒翁摆放的 adb 实测。

## 第二批：花盆、堆肥与挂兜

### 已核实的协议字段

| 请求 | 参数和状态 |
| --- | --- |
| `furniture_load_flowerpot` | `{show_index,replace_index,list,plant_list:[{index,id,stage}]}`，stage 3 成熟，index 从 1 开始 |
| `furniture_flowerpot_harvest` | 请求 index；成功回包 `item_list:[{item_id,num}]`，客户端移除该 index 的植物并展示礼包 |
| `furniture_replace_flowerpot` | index 为已拥有列表的 1 基索引，0 撤下 |
| `furniture_load_compost` | `{show_index,replace_index,compost_list,state,box_index,box_list}`，六个投入槽，空槽为 0 |
| `furniture_putin_box` / `takeout_box` | pos 为 1–6；正在处理的 box_index 不可修改。界面只选择 type 3 特产或 type 15/sub_type 1 肥料 |
| `furniture_replace_compost` | 同样使用列表索引；state >=3 时客户端绘制肥沃土地，state 1 贫瘠 |
| `furniture_load_pocket` | `{show_index,replace_index,list,clover}`；满兜阈值来自 pocketCommonData.base_info，本版本为 50 |
| `furniture_pocket_get` | 无参数，成功 code 0；客户端将兜内 clover 清零并显示物品弹窗 |
| `furniture_replace_pocket` | 同样使用列表索引，成功 code 1、失败 -1 |

主脚本 `CompostView` UTF-16 约 564248、庭院挂兜/花盆刷新约 895895/896357。旧官方响应保留了两种堆肥箱、一个挂兜和陶瓷花盆，因此新状态迁移不会自动赠送已有账号原本没有的物件。

### 本地近似的生产规则

- 客户端没有单独播种请求。放置花盆且青蛙在家时，自动取一份拥有的 type 15/sub_type 2 种子，映射 `floor(plant.id/100)==seed.id` 的真实植物，填入空位。保持配置的两个种植位置。
- 生长默认一小时，前半程 stage 1、后半程 stage 2、到期 stage 3；离线保留绝对截止时间。成熟后每次收获一件同名真实物品；15 个蔬果变体配置没有单独物品，采用“·”前同名基础特产，如不同草莓变体都产出物品 4006 草莓。这个产量与变体映射属于明确近似。
- 堆肥按六槽顺序处理；投入时库存转入槽位，正在处理时无法取出，默认 15 分钟后消耗该槽物品，肥力提高 1–3 级、最高 4 级。每六小时降低一级，最低 1。肥力 >=3 时新播种的植物耗时乘 0.75。真实肥效与施肥算法未恢复。
- 挂兜放置时每五分钟积一草，最多 50；未放置不积累，离线直接按间隔补足到上限。领取一次性移入余额，重复空领拒绝。收益来源与间隔为本地近似。
- 图纸 10501＋松木可制作堆肥箱；10601＋粗布可制作挂兜；10701＋砂石可制作花盆，均需工作台工具、青蛙在家且工作台未被其他任务使用。优先补齐尚未拥有的物件类别，再生成外观变体。原始图纸 10701 文案注明“花盆暂时不制作”，因此这里开放花盆制造是私服可玩性扩展，不宣称为已确认官方行为。

所有近似耗时可通过 CreativeService options 的 `plantSeconds`、`compostSeconds`、`fertilitySeconds`、`pocketSeconds`、`tumblerSeconds` 调整；累计、收获与制造状态同样保存在 creative 模块，纳入快照回档。

## 第二批：普通家具策略

新增 `src/game/furniture/furniture_policy.js` 提供 `buildFurnitureRecipes(catalog,{craftSeconds})`、`planFurnitureCraft(database,account,state,recipes)` 和 `beginFurnitureCraft(service,account,now,recipes)`。没有直接改写普通家具核心，需主服务显式集成。

最新配置有 405 家具定义，但工作台只明确列出 353 个 type 1 可制造家具，另有 36 个不倒翁、15 个堆肥箱和 6 个挂兜条目。默认家具、夕拾/许愿活动家具没有因此假装可制造。普通家具策略覆盖所有 353 个工作台家具，比旧 style 2–9 共 218 个更完整。

家具 ID、名字、种类、图纸、资源和可制造身份来自配置；材料数量、工具类别和耗时仍是本地近似：

- style 2–9 使用已有各风格特殊材料；10/12 迎春使用正丹纸，11 田园使用植物果实，13 夏凉使用棕榈叶，14 彩陶使用岩纹石。
- 织物类使用粗布＋棒针；石材类使用砂石＋毛刷；金属类使用铜块＋锤子；小装饰类使用楠竹＋小刀；其他木作使用松木＋锯子。简易/实用/精制三个等级的同类工具均可。
- 图纸和工具复用；特殊材料必须在工作台后五格预留，通用资源留仓库，开工时原子消耗。默认半小时；可以传入服务配置的时长。

集成方法：将 `service.recipes` 设置为 `buildFurnitureRecipes(...)`；普通 `FurnitureService.advance` 的“寻找新任务”阶段改调用 `beginFurnitureCraft(...)`。旧待制作任务仍沿用其已提交的配方和截止时间，到期结算阶段不变。
