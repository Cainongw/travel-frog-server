# 日历、任务清单、年报和场景收藏

`daily.js` 承接路线图第 6 项，并补齐年报统计、点击特效和美好瞬间请求校验。全部状态存入 `game_module_state.daily`，原始 moments/任务原始采集保留；事务奖励与整账号快照一起恢复。

## 静态证据

复用 REA 主脚本静态证据 `ev_54b142b4e7d9807890a683466175fa62c7c2902457d3d25867ff5872c41410e6`，仍受只分析一个脚本、语义图保留上限等限制。具体字段另外通过普通 Node 静态读取热更新主脚本和 `catalog.readBundle` 解码配置，属于独立静态证据，未声称观察到官方服务端内部算法。

客户端：`exports/dog-apk-build/decoded/assets/game/js/main.min.js`。UTF-16 起点：`AnnualReviewModel` 84138、`CalendarModel` 84667、`GuideTaskModel` 128618、`MomentModel` 150994、`OtherModel` 160663、`CalendarView` 532011。原生 `FrogMotionName` 约 423186，定义 0–13 分别为阅读、打盹、写笔记、手作、吃饭、锯/刷/敲/织/切和四种睡姿。

真实官方采集含：七个新手领取标记、节气日和幸运日数组、三条节气任务、当月每日备注、长期任务/指南进度/清单领奖阶段、年报字段、点击特效和已拥有瞬间。模块使用这些记录初始化，保留旧进度与领奖标记。

## 协议

| 请求 | 形状/含义 |
| --- | --- |
| `calendar_load` | `{new_flag,lucky_days:[{day,item_id}],st_days:[{day,item_id}],task_list:[{id,pro,complete}]}` |
| `calendar_load_note` | `{list:[备注配置ID...]}`，数组顺序对应当月日号 |
| `calendar_get_beginer_reward` | 无参数，返回当日新呱奖励 `day`，配置含物品与数量 |
| `calendar_get_code_reward` | 请求 `day`；客户端已先将已知兑换文字映射成 1–7 日号，用于老账号补领 |
| `calendar_get_st_reward` | 无参数，领取已到日期、全部三项任务完成的节气奖品 |
| `calendar_get_luck_reward` | 无参数，只领取今天的幸运奖品 |
| `task_load` | `{tasks:[{id,pro,is_reward}],list:[{id,pro}]}`，两组分别为奖励任务与指南清单进度 |
| `task_load_list` | `{reward:[{id,pro}]}`，id 为清单类别，pro 为已领取阶段数 |
| `task_get_reward` | 奖励任务 id；检查配置目标，按 `reward_id,num` 发放一次 |
| `task_get_list_reward` | 编码 `id=清单type*100+阶段`，必须按顺序达到配置 target，再发对应 reward |
| `task_client_pro` | 本脚本实际观察到的自报标签只有 `Map` / `NoteFriend`，不接受任意数值伪造任务 |
| `annual_load` | 返回原版年报字段，结合真实数据库数量和新记录累计量 |
| `annual_share` | 记录已查看/分享状态，无平台联动或物品奖励 |
| `other_load_touch` / `other_req_touch` | `{cur,list}` / 请求 id；特效序号 1–8 关联拥有的物品 205001–205008，0 为不使用 |
| `misc_moment_load` / `misc_moment_unlock` | `{list:[ID...]}` / 请求 id；检查配置存在并符合当前场景，已有收藏重复请求安全 |

## 日历本地规则和广告替代

- 按中国时区 UTC+8 刷新月历、日号与登录记录。新呱首七日只允许领取当前创建天数对应奖励；七日之后可用客户端已有的兑换文字补领未领的对应礼包，每日礼包永久只能领取一次。
- 客户端节气任务原文是“观看广告或分享一次、累计获得30草、抽奖兑奖一次”。私服把第一项替换为登录一次，后两项仍基于服务端实际收益和兑奖观察。配套 `client_policy_patch.js` 仅包装 `CalendarNoteView.childrenCreated`，在实际节气任务窗口把第一条改成“登录游戏（进度/1）”；不替换全局广告文本，不影响其他任务、普通日历备注或新呱礼包。该文件须追加到下一版 APK 才生效，旧安装包仍保留原文。
- 无历史排期的新月份，每月 22 日安排一份配置中当月节气食品；幸运日按账号与月份生成两个稳定日期，并从已存在的食物、护符、特产、材料中选奖。日历排期和奖励分布是近似，未恢复官方节气历/幸运概率。
- 当月每日备注从真实 `calendarData.note` 配置中选择，最新配置共 887 个合法备注 ID。旧采集当月备注保留，跨月重新排布。
- 已领节气或幸运项从当前列表移除并存档；跨月不会重新开放已领的新呱礼包，也不清除长期任务领奖标记。

## 任务和清单条件

任务奖励身份、数量、门槛、清单分组和阶段来自配置。可直接观察的进度来自数据库：归来旅行、照片、笔记、特产/收藏、故事、手作、家具、图纸、余额、券、烹饪及聚会成果。已有官方进度取最大值，避免导入账号因为当前库存消耗而倒退。

部分条件需结合行为观察：携带特定食品出发、装满背包/桌面、喂指定邻居、获得草等。`observe(account,type,amount=1,details={})` 可接：

- `clover`、`redeem`、`feed`，分别推动节气与长期累计。
- `travel` 携带 `details.food` 和 `details.fullBag`，记录相应食品/充分准备指南。
- `desk` 携带 `details.full`，记录桌面准备。
- `feed` 携带 `details.guest`，记录三种邻居喜好指南。
- `letter` 记录写信行为；客户端 `Map` / `NoteFriend` 请求只记录已经打开对应页面。

部分“见伙伴”“旅友笔记”等跨模块条件尚只能用最接近的已有持久数据代理；这些条件映射属于本地近似，不是已验证的官方触发公式。图片和材料当前数量也不等于完整历史获取次数；显式观察应在业务成功后调用以提高保真度。

任务奖励中的 200000/100000 作为草资源、200001/100001 作为券资源，其余必须为真实物品。相册扩容物品 9000 会进入现有库存；完整容量副作用由基础背包/商店模块统一负责，不能仅凭此任务发奖即称扩容完成。

## 年报与美好瞬间

年报保留原字段并用数据库已有数量补齐：旅行、图片、故事、笔记、收藏、特产、家具、手作、聚会绘纸等。登录天数只记录启用后的实际不同日；累计收草/兑奖由可信观察新增。它是保留存档的累计报告，不冒充能从当前快照恢复过去每个自然年的全部历史。

美好瞬间不再允许任意数字解锁。正常动作必须匹配当前 `frog_motion` 且青蛙在家；邻居画面匹配当前邻居 ID；商人画面必须处于商店到访时间；彩蛋与萤火虫画面要求当前已记录的对应彩蛋状态。旧收藏始终保留，成功重复请求不再新增。`advance` 对已经满足且配置可显示的场景自动收集，属于本地自然解锁策略；准确的原版拍摄手势仍由客户端控制。

## 接口和测试

`DailyService` 提供同其他模块一致的 `commands`、`initial`、`handle -> {response,events}`、`advance -> {changed,events}`，推送应在 session 回包后发送；`observe` 返回同一事件结构。配置来自 `catalog.config`。

`node --test daily_test.js` 通过 8 项：新手天数与老账号补领；节气/幸运领取防重复；任务门槛与顺序清单、完整快照回档；动态年报；触摸特效归属和瞬间场景校验；跨月重置；失败事务回滚；真实最新配置所有任务奖励、7 日礼包、887 备注和30个瞬间合法性。

尚待主流程 adb 验证日历格子、备注、任务领奖弹窗、年报分页、设置中特效切换，以及拍摄美好瞬间的原生交互。未将这些实机项标记完成。

## 客户端策略补丁和动作枚举

追加方式：`';('+require('./client_policy_patch').clientPolicyPatch.toString()+')();'`。补丁检查目标类存在、保留原方法的 this/参数/返回值，并通过原型标志避免重复包装；无需执行字符串替换或改渠道 SDK。`node --test client_policy_patch_test.js` 验证只改节气第一行、保留其余行、普通备注和新呱备注不受影响，以及重复追加安全。后续还增加了实际 `MainInView.updateDecoration` 空瓶清图，解决花材移除后旧图片残留，见 [decoration-protocols.md](decoration-protocols.md)。

主脚本 `Tabikaeru.Define.FrogMotionName` 的合法映射为：

| motion | 动作 | 生活调度建议 |
| --- | --- | --- |
| 0 | `dokusyo_ie` | 阅读 |
| 1 | `inemuri_ie` | 阅读打盹，不等于整夜睡眠 |
| 2 | `hikki_ie` | 写笔记，MainIn 实际可见动画名称转为 `LW_writing` |
| 3 | `sagyou_ie` | 手作 |
| 4 | `syokuzi_ie` | 吃饭 |
| 5–9 | `saw,brush,knock,knit,cut` | 工作台相关；普通 MainIn.updateFlogStatus switch 未直接处理，需独立动画实测后用于调度 |
| 10 | `sleep_1` | 夜间合法睡姿 |
| 11 | `sleep_2` | 夜间合法睡姿 |
| 12 | `sleep_3` | 夜间合法睡姿 |
| 13 | `sleep_4` | 夜间合法睡姿 |

对应 `HoursType` 为日间 1、傍晚 2、夜间 3、深夜 4。普通生活调度可先选 0/1/2/3/4/10–13；离家状态应由旅行/聚会模块掌管，不在户外替换成在家睡觉。`daily.js` 的 MOTIONS 把 2 映射到最终可见的 `LW_writing`，用于匹配 momentData 的 param，不是错误地改写原 FrogMotionName 枚举。
