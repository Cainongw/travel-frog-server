# 烹饪任务与故事赠礼

`src/game/life/life.js` 为路线图第 7 项烹饪、第 5 项故事赠礼/反馈提供本地可运行流程。客户端配置与协议字段有静态依据，官方时间、概率和伙伴匹配不可见，相关近似规则在本文单列。隔离数据库测试通过，不代表原生页面与全部动画已经实机验证。

## 证据范围

复用 REA 证据 `ev_54b142b4e7d9807890a683466175fa62c7c2902457d3d25867ff5872c41410e6`（本机 `exports/rea-merchant-20261115.json`），其只分析主脚本，语义覆盖有限。此次精确规则另外通过普通 Node 静态读取最新热更新 `exports/dog-apk-build/decoded/assets/game/js/main.min.js` 和解码 `exports/oneplus-official-20261114-live/assets/eab/config.eab` 获得；不将它们称为 REA 运行时观察。

相关 UTF-16 偏移：`CookingModel` 92604，`StoryModel` 190580，`CookingView` 571340，`CookTaskListItemRender` 575149，`StoryView` 1125997，`StoryItem` 1129514。登录补丁只追加在文件尾部，未改变游戏主体这些偏移。

历史官方数据 `exports/oneplus-official-20261114-final/internal/files/jsdata/frog-official-export.json` 有 13 条故事记录，字段为 `id,gift,name,feedback,partner`；`gift` 为已赠送特产，`feedback=-1`。烹饪响应为 `{month:0,week:0,task_list:{},complete:false,select:0,refresh_time,month_pro:0}`。这份记录说明数据形状，不证明所有官方活动当时正在开启。

## 烹饪实际上是节气食物任务

客户端当前烹饪功能不是投入食品材料后等待锅具制作的通用系统。它用 `cookingData_json` 的 24 个条目定义两套年度主题、每月节气食品及 `task_num=6`；`cookingTaskData_json` 定义 8 类行为任务。

| 请求 | 已核对字段与客户端处理 |
| --- | --- |
| `cooking_load_cooking` | `{month,month_pro,week,complete,select,refresh_time,task_list}` |
| `cooking_select` | `index` 为主题序号 1 或 2；食品配置键为 `month + 12*(select-1)` |
| `cooking_refresh_task` | 参数为任务 id；回包 `task` 替换同位置任务，任务行含 `id,pro,complete,refresh` |
| `cooking_complete_task` | 参数为任务 id；成功后客户端标为 complete、month_pro 加一 |
| `cooking_start_cooking` | 无参数；达到食品 task_num 后客户端自动发起。成功后客户端将 complete 置为 true，弹出该食品 |
| `cooking_look_ad` / `cooking_share` | 原客户端广告/分享入口；本服明确拒绝，不伪造已完成广告或分享 |

任务类型分别为：1 登录、2 广告、3 喂养小伙伴、4 获得 80 草、5 出门旅行、6 获得照片、7 抽奖后兑奖、8 分享。实现仅分配类型 1/3/4/5/6/7，进度严格夹在配置目标内，避免客户端以 `pro==state` 判断完成时不匹配。

### 本地近似

- 使用中国时区（UTC+8）每周一刷新任务、每月一日重置月进度和主题选择。每周先给四项普通任务；未完成任务可替换一次为尚未出现在列表或当周领取过的其他普通任务。
- 完成任务每次记一月积分，达到所选食品配置要求后发一份对应食品；每个月只允许领取一套主题，完成后不能切换主题再次领奖。
- 登录任务在初始化周任务时视为完成；其他任务只接受可信服务端观察或数据库变化，客户端不能直接上传任意进度。
- 刷新日程、任务组合、每月只能一套主题均为本地规则，仍待官方对照；配置证明食品身份与积分门槛，不证明该调度算法。

## 故事赠礼与反馈

客户端 `StoryData` 默认 `gift=-1, feedback=-1`。`StoryItem` 只有 gift -1 时显示送礼入口，且只从特产栏选择；`story_send_gift` 发送 `id,gift`。`story_load` 返回 `{stories,new_story_id}`，`story_read_new_story` 只清除新故事提示。

**`story_feedback_gift` 的 id 是赠礼邮件编号，而不是故事编号。** 源码 `MailView.acceptTouchEvents` 在 `Mail.EvtId.StoryGift=6` 时传 `mailInfo.id`，用户选择感谢后仍由原 `mail.open` 领取邮件。故事事件 `Story=8`、`StoryGift=9`、`StoryFeedback=10`，发送者名称位于 `evt_string[0]`。

实现保留原 stories 表及条目中的未知字段；送礼只扣一份真实 type 3 特产，重复发送相同礼物不再扣，不能改送另一份。回礼采用原生 type 6 邮件，先保存邮件和状态再通知；感谢只记一次反馈事件，不直接发物品，领取仍走现有事务 `mail.open`，不能重复领取。

### 本地近似

- 旅行成功出发时，参考客户端 `story_json.const.friend_choice_percent=25` 作为新故事触发概率，最多每小时一篇，优先尚未拥有的配置故事。概率常量有客户端依据，但是否等于官方服务端算法未知。
- 本服不联系真实玩家。新故事的伙伴采用明确本地 NPC 名字和内部编号；已导入故事保留原伙伴名字和编号，后续回礼由本地模拟。
- 赠送后默认 10 分钟收到一份真实特产回礼，从配置 type 3 物品中选择；数量与分布属于近似。
- 已导入记录中 gift 非负、feedback 为 -1 的旧赠礼，在首次启用本模块时重新等待一个反馈周期；不宣称恢复了官方未完成的实际网络赠礼。
- 未读新故事不会被另一新故事覆盖。已收集故事不因关闭提示、送礼或反馈而被删除。

## 接口与集成

```js
const {LifeService}=require('./src/game/life/life');
const life=new LifeService(database,catalog,{
  clock:()=>Math.floor(Date.now()/1000),
  feedbackSeconds:600,
  storyCooldown:3600,
});
```

同其他模块提供 `commands`、`initial(account)`、`handle(account,cmd,data)->{response,events}`、`advance(account)->{changed,events}`。所有 `events` 都应在 session 响应后推送。

`observe(account,type,delta=1)` 接受 `login/feed/clover/travel/photo/redeem`，返回 `{changed,events}`。应在真实业务事务成功后调用：如喂食成功、草实际入账、旅行确实建立、图片确实创建、待兑球实际结算。更新时会刷新观察基线，避免随后的被动观察重复计数。`advance` 对余额净增、旅行计数、新图片数量、邻居已喂状态和抽奖待兑状态另作兜底；净余额与当前照片数不能替代完整业务事件，例如先获得草又消费可能被净值抵消，所以主服务仍需接显式观察。

烹饪进度、排期、故事回礼队列和感谢记录存入 `game_module_state.life`，真实故事、邮件和库存仍在原账号表。全账号快照回档必须把这些表一起恢复，不能只恢复模块 JSON。配置缺失时不能生成虚构食品/故事/奖励。

## 验证

`node --test tests/life_test.js` 通过 8 项：

- 烹饪任务观察、主题、积分、跨周和月重置、每月食品仅一份。
- 任务刷新不重复/不伪造进度，广告与分享明确拒绝。
- 故事送礼一次扣除、定时原生邮件、感谢和实际领取分开且均不重复。
- 新故事触发与未读提示保留。
- 导入故事未知字段保留、旧待反馈续行、完整快照恢复不多发邮件。
- 数据库失败回滚送礼和食品发放。
- 数据库观察兜底及显式观察不重复。
- 最新私有 APK 的 24 个食品和 25 个故事定义全部可解析，产物身份存在。

主流程仍需用 adb 验证原生烹饪主题选择、任务页面刷新、食品弹窗、故事选择礼物、回礼邮件与感谢弹窗的实际操作。
