# 跨模块称号与图鉴自然进度

`progression.js` 的 `ProgressionService` 负责称号、特产图鉴、旅行百科和植物百科。美好瞬间由另一个模块处理，不在此服务内强制解锁。

## 配置依据与覆盖范围

最新 `Achieve_json` 共103条，`coverage()` 返回每条的 `id,name,info,kind` 及依赖参数，便于后续版本发现新增或未识别条件。本地最新配置核对结果为**103条都能分类、没有漏映射的库存物品、35个城市有图片对应关系**。

这些条件多数直接来自客户端文案，而非官方黑盒统计口径；阈值照文案实现，必要的旧名称映射和缺少触发时机的近似单独说明。主要规则：

| 条件 | 当前可信来源与处理 |
| --- | --- |
| 默认、旅行次数 | 配置阈值与账号已提交的 `trip_count` |
| 纪念品/特产种类 | 账号 `handbook`；普通库存 Item ID 与 Collection ID 不混淆 |
| 所有特产食材 | 当前 `Specialty_json.itemId` 列表，不硬编码旧版总数 |
| 库存超过 N 个 | 当前仓库数量严格大于 N，与“超过”文案一致 |
| 登录天数 | 中国时区不重复的实际登录日期，重连不增加同日次数 |
| 30分钟内返家、24小时未归 | 真实提交的旅行时长或仍在进行的长旅行 |
| 连续4次果汁 | 旅行百科中 `name=果汁` 的各物品变体和明确果汁名称，支持可选事件ID防重复计次 |
| 博物馆典藏 | 配置 `Collection.type=3` 或博物馆 `collection_id` 的**独立典藏数量**，不是博物馆到访次数 |
| 花苞/开花阶段 | 正在摆放的蜡梅/木槿插花状态，或可信服务端 `flower-stage` 事件 |
| 全国城市都有照片 | `GoalNumber.tag → PictureTag.picNames → Picture.id` 35个城市映射；博物馆目标不算城市 |
| 六一登录 | 中国时区6月1日确实登录 |
| 周年称号 | 已记录的可信周年事件；本地补充“账号创建满一年且在创建周年当天登录”或完成聚会蛋糕 |
| 900/901/902特殊称号 | 客户端 type14/sub_type8 道具按名称映射称号和有限有效期，不能永久凭库存拥有 |

配置与现 Item 文案有四处名称差异，采用显式映射：苏州西瓜子→西瓜子、蜜柑→桔子、桃子→蜜桃、莜面→莜面栲栳栳。物品类型与 ID 对应关系支持这些映射，但官方实际旧称号统计口径仍应通过样本核实。腊梅/蜡梅也作同义处理。其它未来未知条件保持 `kind=unknown`，不会默认发称号。

## 自然数据来源和事件接口

`sync(account)` 每次读取权威游戏表及模块状态，返回 `{earned,expired,bookChanged,encyclopediaChanged,handbookChanged,itemChanges,events}`。上层必须发送全部 `events`，不能只在 earned 时推角色，否则特殊称号过期/道具消耗和新百科状态无法更新到客户端。

- `creative.flowerpot.plant_list[{id,stage}]` 通过 `flowerpotData_json.plant` 映射种植名称，分别解锁主图和已经观察到的成长1/2/3。
- 已有官方 `client_load_decorate`、独立 `decoration` 模块顶层及任意模块的 `decorate/decoration` 对象中的 `has_list,put_id,status` 映射 `decoration_json`，记录拥有和插花阶段。独立模块的真实 `stage_history[{id,stage,at}]` 也会读取，因此花材替换/到期后仍能自然取得曾观察阶段对应的73/74/79/80称号。插花1/2与成长1/2/3分别推进，不能只种熟就解锁全部插花图。
- 特产获取来自当前正数库存、背包/桌面或可信 `item-acquire` 事件；发现记录永久保留，之后消耗不清图鉴。
- 博物馆典藏来自 `handbook.collections`，探索模块正常写入后自动计算。可用 `collection-acquire({id})` 或 `museum-acquire({collection_id,collections})` 记录有配置身份的典藏。
- 城市照片来自普通/待收/回收/礼品盒，以及 `animpicture` 中的起始照片、排队照片与存储照片。曾获得的城市记录保留，即使后来删除或消耗照片；这是明确的本地统计策略。
- `partycake.cur_state=6` 触发本地周年庆达成；没有对应明确103条称号文案的故事/烹饪/日历动作不会硬塞一个不相关称号，其奖励物品仍自然推进库存/特产/百科。

`record(account,event,data)` 支持 `login`、`trip-start({food,event_id?})`、`trip-return({duration,place,pic_id,event_id?})`、`flower-stage({plant,stage})`、`plant-stage({plant,stage})`、`item-acquire({item_id})`、`collection-acquire({id})`、`museum-acquire({id,collection_id,collections})`、`anniversary-login`。这些是内部可信结算接口，不应直接暴露为客户端可任意提交的“解锁称号”入口。现有服务端无需为库存/花盆/博物馆额外手动发成就，只要成功更新状态再调用 sync。

## 限期称号

获得对应道具后，下一次 sync 在同一事务内消费该道具并激活称号，根据 `·N天` 文案将有效期叠加到 `max(now,旧到期时间)`；重复 sync 不重复延时。有效期保存在 `progression.special_titles`，道具库存归零，更新角色和库存推送。

到期后移除这次本地激活的称号；若正在使用它，则回到默认称号0。与该本地激活无关、官方原始导入且没有可用到期证据的其他特殊称号不会被凭猜测删除，原始 capture 始终不改写。

## 图鉴协议

处理 `encytravel_load/set_show_sub` 和 `encyclopedia_load/set_show_sub`。旅行百科在拥有过对应道具时解锁配置条目；植物百科按取得、成长、插花阶段解锁。条目使用真实 `long_id`，不能把父级 `id` 当作图片条目。描述与原有数据合并，已有官方 `unlock_list/unlock_desc/show_sub` 不丢失；保存展示项只接受已经解锁的真实配置条目。

描述的具体逐句解锁机制没有完整官方规则：旅行百科先完整揭示对应物品描述，植物百科按观察阶段逐句揭示，属于明示近似。当前最新配置支持159条旅行百科和241条植物图鉴条目。

## 验证边界

`node --test progression_test.js` 包括9项测试：阈值与登录去重、博物馆典藏正确命名空间、果汁变体/事件去重、限期道具消费叠加与过期、花盆与插花分阶段百科、独立插花模块真实阶段历史、35城市资源映射方法、动态照片仍计入城市、消耗后图鉴保留、原描述合并，以及完整本地103条配置的隔离判定覆盖。

103条覆盖测试使用权威数据和内部事件构建各条件已满足的隔离夹具，验证所有判定能达成；它不代表已经在手机上等待360天、走完35城市或观察了全部官方概率。客户端真实领取提示、图鉴页面与各模块最终流程仍由主任务实机验证，不能仅凭本测试勾选路线图全部完成。
