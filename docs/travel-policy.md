# 旅行选择与道具消耗策略

`src/game/travel/travel_policy.js` 是无数据库依赖的本地策略模块。它消费 `PostcardGenerator` 的可生成场景，提供稳定路线编号、随机路线/同行选择、计时、奖励候选以及背包消耗/返还计划。它不自行修改存档或启动定时器，选择结果必须由调用方持久化，重启不得重新抽路线或重置时间。

## 可确认的配置事实

- `Item_json.type` 区分旅行食物、护身符和工具；`spend=1` 表示消耗品，`spend=0` 的工具/玉佩可返还。消耗计划逐槽生成，保留输入背包长度，修复固定重建成五格的前提。
- 食物文字明确区分随身点心、短途、远行、想家，以及海边/沙漠/水乡/雪地偏好。
- 绿色/白色/红色/蓝色铃铛的说明分别提示东/西/南/北；桃色铃铛提示新地点。
- `Picture_json.place/location`、`GoalNumber_json` 提供地点信息。`Specialty_json.place`、`Collection_json.place` 提供地区与收藏分类；`Note_json.factorType2` 的 Friends/Own_Note 提供部分附加条件。

## 明确采用的近似

客户端没有带上完整 Area/Node/NodeConnect/NodeEdge/NodeGoal/NodeItem 与服务端随机算法。因此路线选择不是官方寻路复原：

- 首先按 Normal/Goal/Tools 分组分配权重，再在组内抽取，避免 156 张景点配置直接压过 39 张普通场景。默认组权重为 0.55/0.35/0.10；华夫饼偏附近、夹心面包偏远行、蛋包饭偏较早回家。
- 地方食物按其名称和描述对应的地点提高权重；铃铛方向提高对应地区权重；海边/沙漠/水乡/雪地食物提高相应地点权重。倍数（12、3、4）均是可调整的本地近似，没有宣称为官方概率。
- 60% 概率从该场景实际有资源的同行者中随机选择；其余独自旅行。不会选择缺少素材的同行者，也不按次数固定轮换。
- 默认附近旅行 30 分钟至 4 小时、远行 4 至 24 小时、在家等待 15 分钟至 2 小时；基础食物作明示的短途/想家修正。这些耗时只表达接近原玩法的节奏，未由官方样本证明。构造 `timing` 或单次 `durationSeconds/homeRange` 可调整并供测试加速。
- 旅行奖励候选从相应地区已有特产/收藏中选择；笔记只选择可满足 Friends/Own_Note 条件的 Drop 笔记。默认一张照片、一份特产，45% 笔记、18% 收藏，均为近似掉落策略；不是复原服务端全部产出池。
- Unique 活动图默认不参与普通旅行，必须由明确活动来源调用。工具场景与季节过滤沿用生成器的规则，尚未知的历史活动开关不凭空开放。

## 接口

```js
const {TravelPolicy}=require('./src/game/travel/travel_policy');
const policy=new TravelPolicy({generator,config:catalog.config,random:Math.random});
const selection=policy.select({
  bag:[2,1002,2003,2000],
  season:1,
  ownedNoteIds:[1000],
  seenPicIds:[100,2000],
});
```

返回 `{route,companionId,durationSeconds,homeWaitSeconds,spending,rewards,provenance}`：

- `route` 为可序列化对象，含 `id/picId/destination/region/place/pictureType/specialtyId/noteId/companions`。
- `rewards.noteId` 与 `rewards.collectionId` 允许为 null；这是实际抽中的奖励，调用方不应无条件用 `route.noteId` 发笔记。后者为兼容旧旅行结算的有效候选字段。
- `spending` 为 `{consumed,returned,nextBag}`。记录 `slot/item_id/count`；`nextBag` 与原背包同长度。装备在出发前已经从库存预留时，只在归来返还 `returned`，不可重复扣 `consumed`。
- `routes()` 返回全部可用路线；原屋顶/海边/树枝/竹林/麦田编号保留 0–4，新路线编号为 `10000+picId`。`route(id)` 可从持久行恢复；未知编号返回 null，不偷换路线。
- `homeWait(context?)` 返回一次抽中的在家等待秒数，应与绝对出发时间一起持久化。它不直接从桌面搬物品，自动出发与桌面补给由持久层整合。

新实例需要相同客户端配置与素材，以保持保存路线的解释；客户端升级移除配置时应保留旧路线的完整快照或明确迁移，而不是换成另一张图。

## 测试

`node --test tests/travel_policy_test.js` 覆盖四格背包、消耗/返还、稳定路线编号、食物近远差异、方向偏好、工具场景限制、笔记前置、非法输入，以及真实素材目录下跨场景生成。统计测试使用固定随机种子，检查策略可观测的差异，而不是官方概率准确性。

仍需核心旅行状态机接入并验证等待、出发、离线归来、重复请求、邮件/新图领取、保存与回档。此模块通过不代表路线图第 10 项已端到端完成。
