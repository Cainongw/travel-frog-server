# 博物馆探索、古琴协议与周末挑选活动

实现为 `exploration.js` / `ExplorationService`，沿用 `ActivitiesService` 的构造和资源结算辅助方法。`handledCommands` 24 个；`initial(account)` 返回事件数组；`handle` 返回 `{response,events}`；`advance/observe` 返回 `{events}`。状态存入 `game_module_state`，所有写入与物品/相册/图鉴结算共用 SQLite 事务，支持 JSON 存档和账号快照。

## 静态依据与未知边界

分析复用本机 REA Evidence `ev_54b142b4e7d9807890a683466175fa62c7c2902457d3d25867ff5872c41410e6`（语义图部分覆盖）以及普通 Node 精确读取最新热更新主脚本。模型 UTF-16 起点：`MuseumDayModel` 151649、`MuseumModel` 156941、`LotteryModel` 147185、地图 `MuseumDayExploreMap` 959905。资源配置提供 `museumData_json`、`museumDayData_json`、`museumDayCommon_json`、`museumDayDesc_json`、`lotteryData_json`。这不是官方服务端运行记录。

真实导入样本有已收集的博物馆列表（山东、南越王、吴文化）及其图片/收藏品；春游活动关闭、无路径；周末挑选为第180期已选择五个物品、状态2。初始化保留这些历史，额外推定的本地期限和状态不覆写原始 capture。

`koto_*` 在本次主脚本搜索中只找到 9 个协议声明，没有找到对应 model、界面 consumer 或独立配置。因此它复用本地探索引擎并独立存档，协议可测试，但**当前客户端的古琴入口和完整渲染行为尚未验证**，不能称其官方玩法已恢复。应继续查找其他版本/动态脚本或官方操作证据。

## 博物馆探索

支持 `museumday_load/refresh/random_compass/dir_compass/get_items/arrive/start_advance/load_path/info/inspire`。

已核实客户端需要：

- `path` 数组，每格 `{grid,type,style}`；`grid` 从1至35，按7列5行换算坐标。不是 `{x,y}`。
- `frog`、`next` 是路径位置，从1开始。路径非空时，初始化为 `frog=next=1`，否则原界面会直接访问 `path[-1]`。
- `items/get_items` 为 `{item_id,num}`；日志为 `{time,desc,item_id,item_num}`；历史为 `{id,desc_id,pic_id,time,items}`。
- `refresh` 回 `left_num`；随机罗盘回 `next,inspire`；方向罗盘回 `code`；info 回 `compass,task_num`。
- 到达终点时界面先领取物品，展示结算卡，再发 `arrive` 确认结束。`arrive` 清除当前地图并把结果加入历史，重复确认拒绝。

本地地图生成不重复、正交相邻的合法路径，格子使用资源中存在的 `md_cell_0_0` 和 `md_cell_1..4_1`，终点显示对应博物馆目标。刷新只允许起步前，开始后不能刷新或改选目的地。再次探索扣费来自 `restart_clover` 配置。方向只接受1上、2下、3左、4右，并验证确实指向下一个合法路线格。

**本地近似：**活动有效期30天，每日3个罗盘；成功出行/采摘等玩法动作按 `base.v1` 计数补罗盘；每消耗配置数量罗盘增加一次鼓舞。随机罗盘推进1至3格，鼓舞推进3格；青蛙每300秒实际走一格，支持离线推进；中途获得松木/显影液/券等客户端已有物品，终点给对应博物馆门票和配置中的一个收藏品。这些到达时间、路径、途中掉落与概率尚无官方服务端证据，可通过 `moveSeconds,dailyCompasses` 等选项调整。

可传 `pictureFactory({account,module,museum_id,pic_ids})` 来生成终点明信片。返回图片必须是该博物馆配置的 `pic_id` 和非空图层；服务分配新 ID 并加入待收相册。未提供生成器时只发票/收藏，**不会伪造一张无图层的明信片**。需要与完整明信片生成服务整合才能覆盖终点图片。

`museum_load` 将官方原始记录与当前门票、收藏图鉴、普通/待收/回收/礼品盒内的对应照片合并。保留已有博物馆数据，不因本地新探索清空旧图鉴。

界面导航：`MuseumDayPopupViewControl` 无参数；未开始地图时进入历史页后点首次探索。直接打开 `MuseumDayExploreViewControl` 前必须已 `refresh` 建立非空地图。`MuseumDayHistoryViewControl` 和 `LotteryViewControl` 无参数。

## 周末挑选（lottery，独立于五券抽奖 item.gacha）

客户端状态已确认 `Open=0,Select=1,Complete=2,Reward=3`。支持：

1. `lottery_load` 返回 `phase,last_phase,state,select_list,answer,extra_item,right_flag,egg_num,reward`。
2. `lottery_open` 在本期只能一次，发开场奖励，回复 `open_item,extra_item` 并进入选择。
3. `lottery_select({list})` 必须是五个互不重复的当前候选物品；不消耗这些物品，因为这里提交的是建议选择而非实际库存馈赠。
4. 等待结算后 state=3，计算 `right_flag` 和显示奖励。`lottery_confirm_reward` 发奖励一次，清除待领奖状态；同一星期不能再次领取开场奖励。

**本地近似：**按中国时区每七天一轮，候选从已存在的食品/护身符/特产中取最多15个；选后1小时结算（`lotterySeconds` 可调）。前三位邻居对可识别特产的偏好用 `Character.taste`，其余尚无依据的匹配以50%随机推定。开场奖励1券，结算至少1券，命中三个以上附1显影液，均为明确本地奖励；不宣称复刻官方周末时段、奖池或隐藏彩蛋规则。

## 验证

`node --test exploration_test.js` 的8项测试覆盖：合法地图坐标与邻接、非瞬移计时、离线走格、途中一次性领取、终点票/收藏/生成器图片、重复终点拒绝、错误方向/写库失败回滚罗盘、每日不重复加币、库存罗盘转换、鼓舞次数、koto与museumday隔离、挑选五项校验/等待/结算/一次领奖/跨期、官方旧记录导入、正在移动和待结算活动随快照恢复。

最新完整配置+真实转换存档的隔离内存 smoke 通过：24个命令、4条当前活动博物馆、3个原始博物馆记录和5个已选物品保留，刷新生成合法路径，原始 capture 未变化。实际地图页、终点动画、古琴入口及周末挑选的原生交互由主任务继续实测；静态字段和私服测试不能替代这些验证。
