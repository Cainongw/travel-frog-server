# 贺卡、新春贺卡和聚会蛋糕

实现：`src/game/activities/cards.js` 的 `CardsService`，与 `ActivitiesService` 相同构造参数和 `initial/handle/advance/observe` 接口。该模块继承前者的资源结算和家具解锁辅助方法；38 个协议独立于第一批活动路由。所有 events 在 session 回包之后发送。

## 证据

复用 `exports/rea-merchant-20261115.json` 的静态应用证据（`ev_54b142b4e7d9807890a683466175fa62c7c2902457d3d25867ff5872c41410e6`），并普通 Node 静态读取最新客户端。模型 UTF-16 起点：`GreetCardModel` 121281、`SpringCardModel` 182636、`PartyCakeModel` 161406；`PartyCakeQaView` 977123；状态常量附近 423948；`CardItem` 1132013。这些不是实机观察。

配置来自当前 `config.eab`：`greetCard_json` 有 5 个背景、25 个贴纸、背景价格梯度、贴纸价和两组寄出奖励；`springCard_json` 有 5 个背景、12 个贴纸、任务/购买权重、交换上限与礼盒 ID；`PartyCakeData_json` 有 5 个蛋糕部分、各部位奶油/糖消耗与奖励、任务计数和材料奖励、点蜡烛奖。

## 贺卡

支持 `greetcard_load/load_count/buy/change_bg/change_bless/put_tags/send/get_reward/get_task_item/get_task_reward/send_gift/feedback_gift/read_new/stock`。背景和祝福/贴纸 ID 均校验配置，背景按本轮价格购买一次，背景/贴纸放入时扣除、更换时归还，三张贴纸须不同类别。寄出后清空制作区、记录历史，领奖使用配置指定的自选奖加随机奖，不能重复领取或跳过待领奖再寄出。用完本轮全部背景后可补货，并使用下一轮价格。

**本地近似：**历史活动在本地持续 30 天；每日登录提供三个不同类别贴纸，避免广告/分享依赖；寄出贺卡后 1 小时收到“远方的小伙伴”NPC 回信。回信是明确的本地模拟，不连接外部社交服务；对回信赠送一个持有的特产后，1 小时收到 30 草回礼邮件，邮件类型按客户端 `Mail.EvtId.CardGift=14`，可感谢但不再额外发奖。每日登录发贴纸、NPC 等待时长和礼物价值均非官方服务器实测规则。

完整字段保留客户端需要的 `card_info,items,send_list,get_list,stock_num,task_login,task_share,new_index,can_reward`。贴纸存在活动内部物品表中，不能混入普通 ItemDB 库存。原始旧贺卡历史和 NPC 等待队列随账号持久化、导入导出和快照回档。

## 新春贺卡

支持 `springcard_load/load_count/buy/change_bg/change_bless/put_tags/send/get_reward/get_task_item/get_task_reward/share_tags/get_share_tags`。背景与祝福语选择免费，贴纸购买使用配置价和 `buy_weight`，每日登录/采摘任务使用 `task_weight`。寄出扣除已放入的贴纸并产生一个待开启礼盒；开盒后才可再次寄出，开盒一次后清零。

**本地近似：**活动 30 天；每天三次贴纸购买，采摘任务每天最多三份贴纸；每日登录发三个不同类别贴纸。稀有贴纸全部为低购买权重时使用大礼盒，否则小礼盒。由于原服务器礼盒掉落表未取得，小/大礼盒采用存在于客户端的 1 券、8002 显影液或10001松木等概率奖励，可由 `springRewardIds` 配置；不虚构实体奖品发货。

`share_tags` 实现的是**私服内真实一次性贴纸交换码**，而非假装社交平台分享验证成功：扣除自己的贴纸，生成随机交换码，24 小时有效；另一个本服账号兑换才转移该贴纸，拒绝自己、过期或已用的码，按配置每日最多三次。服务端读写双方 `game_module_state` 在一个事务内完成。管理员对单账号回档可能同时倒转其发行码的使用记录，这是有权限的存档恢复语义，不应将它当作不受管理操作影响的跨账号经济流水。

## 聚会蛋糕

客户端状态常量已确认：`making=0,make_reward=1,qa=2,qa_reward=3,light=4,light_reward=5,complete=6`。支持 `partycake_load/load_mate/load_task/load_qa/get_mate/make/reward_make/answer/reward_qa/light/reward_light`。原配置的部分开放时间、部位消耗和奖励不改写；材料不足、同部位重复制作、跨步骤领奖均拒绝。失败回包携带当前 `state`，不能返回 -1，否则客户端只比较状态值而误扣本地材料。

完成每部分全部部位后，本地安排邻居喜好问题。三种已知特产与邻居来自客户端目录，正确答案取 `Character.taste` 与 `Specialty` 顺序对应的最高喜好；首次错误可再答一次，两次错误进入基础奖励。答题领奖后进入下一部分，最后完成制作后点蜡烛，再领取配置的最终奖励，每阶段均一次性结算。

**本地近似：**每部分一次问答；答对奖励 1 券+1松木，答错奖励1券。任务每天中国时区刷新；真实登录、商店购买、普通抽奖和出行等成功动作推进配置规定的次数，到目标后发配置奶油和糖到待领取区。不伪造广告或分享任务完成；`partycake_reward_share` 返回明确失败和原因。材料领取后清零，不能重复领取。答题次数、基础奖励和每日刷新周期不是官方黑盒概率还原。

## 验证

`node --test tests/cards_test.js` 的 8 项测试覆盖：购买/装配/发送/一次性奖励、离线 NPC 回信和赠礼回信、同类贴纸拒绝与替换归还、背景补货价、新春礼盒一次性领取、每日购买与任务、跨账号交换码仅一次、蛋糕真实任务进度、逐部位制作/答题/点蜡烛完整状态机、广告分享拒绝、存储失败事务回滚、账号隔离和快照/JSON恢复。

最新完整配置与真实转换存档在隔离内存库初始化 smoke 通过：38 命令、25 中秋贴纸、12 新春贴纸、5 蛋糕部分、导入原有奶油5保留。未操作真实手机或真实数据库；三个页面的实际原生流程由主任务继续验证，不能用这些协议测试声称整个路线图已完成。
