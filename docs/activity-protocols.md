# 活动第一批：动态照片、扭蛋、许愿池

本说明区分客户端与资源的静态事实、导入存档的历史记录和本地近似规则。实现为 `activities.js`，不声称恢复了官方概率或历史活动日历。广告与分享领奖没有在这里返回假成功。

## 证据与覆盖

- 分析目标：`exports/dog-apk-build/decoded/assets/game/js/main.min.js`。该脚本由用户提供的官方 APK 与热更新脚本产生，额外包含已知本地登录补丁；本次没有执行整份游戏脚本。
- 已有 REA 静态 Evidence `ev_54b142b4e7d9807890a683466175fa62c7c2902457d3d25867ff5872c41410e6`，完整本机包 `exports/rea-merchant-20261115.json`。该分析只选择主脚本，语义图达到默认节点/未知记录上限，不是运行证据。
- 下列精确字段另外来自普通 Node 读取的源码片段：`AnimPictureModel` UTF-16 起点 79434、`CapsuleModel` 89317、`WishingPoolModel` 223993、`AnimPictureEmptyPage` 495562、`AnimPictureMakePage` 500981、`AnimPictureShowPage` 505939、`CapsuleView` 539326、`WishingPoolView` 1181043。游戏补丁和资源版本变化后应重新定位，不把这些偏移当字节位置。
- 配置：`exports/oneplus-official-20261114-live/assets/eab/config.eab`，通过已有 EAB 解码器读取 `animpictureData_json`（6 个场景、阶段经验及动态图层）、`capsuleData_json`（25 个奖项、8 种任务、3 个里程碑、快速完成价 30 草）和 `Item_json`。
- 真实导入样本 `animpicture_load`：`page_num=1`、已进行场景 1、`phase=3, exp=27, guide=6`；三个活动的原始协议仍保留在 `official_archives`。扭蛋和许愿池样本原为关闭，开启后的周期是下面明示的本地规则。

## 接口与后置推送

```js
const service = new ActivitiesService(database, catalog, {
  stateStore: new ModuleState(database), // get/set 或 ModuleState 自身别名
  furniture,                          // 可复用现有 FurnitureService
  now: () => Math.floor(Date.now()/1000),
});
```

`catalog.config` 为完整解码配置；`items`、`furniture` 采用现有目录字段。`handledCommands` 是 Set；`initial(account)` 返回事件数组；`handle(account,cmd,data)` 返回 `{response,events}`，不支持的命令返回 null；`advance(account,now?)` 返回 `{events}`。业务失败返回明确非零 code；写库异常抛出，以便上层日志记录与事务回滚。

原客户端成功回调会修改数组、减币、变更阶段，所以必须先发送 session 回包，再推 `events`。本实现返回的资源事件均为绝对余额/数量。`observe(account,cmd,data)` 只应在其他玩法的操作已成功结算后调用，用于推进扭蛋任务，不能在失败请求上调用。开发过程中的 `advance` 可以在线定时和重连时调用。

所有模块状态在账号的 `game_module_state` 中，配合全部账号游戏表事务、导出导入与快照一起保存。模块持有的完整照片也在这个状态中，不能只备份 `postcards` 表。

## 动态照片

已确认的协议：

| 协议 | 参数与回复 | 行为 |
| --- | --- | --- |
| `animpicture_load` | `guide,page_num,item_num,pic_list,making_index` | 线端制作索引从 1 开始，0 为无；客户端加载后减一 |
| `animpicture_guide` | 无参数；`code` | 保存引导步骤，最多 6 |
| `animpicture_select_pic` | `id`；`code` | 选择支持场景的相册照片，开始一页动态照片 |
| `animpicture_add_pic` | `anim_index,ids`；`code` | 加入同场景素材，最多 5 张 |
| `animpicture_remove_pic` | `anim_index,pic_index,is_delete`；`code` | 从开发队列删除或取回完整原图 |
| `animpicture_use_item` | `anim_index,item_id`；`phase,exp` | 消耗显影液、推进阶段，失败 `phase=-1` |
| `animpicture_get_item` | 无参数；`code` | 完成后领取积累的存储开启物，重复领取拒绝 |
| `animpicture_open_album` | `index`；`code` | 消耗 9002 开启一个存储格，最多配置的 4 格 |
| `animpicture_album_add_pic` | `anim_index,pic_index,pic_uid`；`code` | 同场景照片从普通相册移入已开启的空格 |
| `animpicture_album_remove_pic` | `anim_index,pic_index,is_delete`；`code` | 删除或取回，不覆盖其他图和不复用原 ID |

一页状态为 `{id,phase,exp,exp_pic,pictures,put_num}`。阶段阈值和动态图层完全读配置；制作相框 9001 的拥有数量增加可制作页数，存储开启物来自完成奖励。来源照片保存在内部 `source_picture` 元数据中，正常相册不重复显示。模块移入/移出使用原始 ID 和图层（含半像素），冲突会拒绝，不覆写别的照片。

**本地近似：**同时只制作一页；队列每 1800 秒消费一张照片，增加 20 经验；显影液 8002/8003/8004 分别加 40/80/120 经验。可通过 `photoSeconds,photoExp,itemExp` 调整。阶段终点发 1 个 9002，未消费的排队照片返还。离线按已提交期限推进，重复推进不重复完成。选择起始照片的消耗、普通照片经验和时长尚无官方服务器样本，不能标为官方确认。

## 扭蛋

`capsule_load` 字段为 `end_time,coin,pre_coin,reward_list,task_list,patch_num`；`capsule_load_coin` 返回币与待领取币；`capsule_load_task` 返回任务数组。`capsule_patch` 补充任务；`capsule_fast_task(index)` 按配置扣草完成；`capsule_get_coin` 领取 `pre_coin`；`capsule_twist` 回复 `reward_id`。

客户端明确限制每期 16 次，回包的 `reward_id` 对应 `capsuleData_json.reward`，奖品 ID/数量和三次/七次/十二次里程碑均按配置发放。200000/200001 奖励分别是草/券，不能当普通库存道具。与配置同名的家具活动物品同时解锁对应家具，避免只给展示道具却不能摆放。

**本地近似：**活动在本地持续 30 天，期末开启下一期；每日中国时区提供两份任务机会，从非分享任务中不重复选两种，积累上限 32。已成功的收草、准备食物、花草、出行、喂食、消费券、存照片推进对应任务。没有新动作就不完成任务。任务完成生成待领取币；领取一次后清零。普通库存中的扭蛋币 200005 会转入活动币。抽奖从未获得且客户端有定义的奖项均匀选取，不冒称官方权重。新的一天保留本期历史；重读、重启不重复每日发任务。尚需官方样本核对任务选取、掉落、期末剩余币和补任务规则。

## 许愿池

客户端只有 `wishingpool_load` `{end_time,coin,items:[{id,num,limit}]}` 和 `wishingpool_wish` `{id}`。本包未找到完整许愿池奖池配置，故不声称下面的奖池来自官方。

**本地近似：**活动 30 天，每日中国时区加 1 次许愿（可设 `wishDailyCoins=0` 停用）；默认奖池使用存在于当前 Item 配置的 201005/201006/201007 许愿家具、8002 显影液、10001 松木和 200001 券，每项 1 个、限 1 次，等概率抽取未耗尽项；可用 `wishRewards` 覆盖。200016 开启道具每个折成 5 次许愿。限量耗尽不因读页面而刷新，下一周期才刷新。家具奖励同步解锁真实家具。币不足或奖池为空时拒绝，不消耗资源。

## 验证范围与限制

`node --test activities_test.js` 覆盖制作/取回/永久删除/开发液/离线完成、半像素图层保留、同 ID 冲突拒绝、跨账号隔离、一次性奖励、快速完成事务失败回滚、每日刷新不重复、币不足拒绝、家具解锁、最小官方阶段导入与跨 SQLite 重开、活动照片和奖励随账号快照一起回档。原协议没有每次消耗的唯一操作号；可以拒绝重复领取及已用照片，但不能在任意网络时序下区分“重复的无参数抽奖”和“新的一次抽奖”。

最新完整配置在内存库导入真实转换存档 smoke 通过：19 个命令，6 个动态场景，25 个扭蛋候选，初始化的三个协议字段齐全，创建账号快照成功，原始 capture 未改变。该测试没有修改真实数据库。

这些是私服逻辑与协议验证；原客户端各页画面、交互动画、活动入口及完整官方操作前后对照仍需父任务实机验证，不能把本文件视作“所有活动已完成”。贺卡、蛋糕、博物馆等活动不属于此第一批。
