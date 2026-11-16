# 协议覆盖复查与仍需验收的玩家入口

扫描时间：2026-11-16；来源为本机 `exports/dog-apk-build/decoded/assets/game/js/main.min.js`，SHA-256 `55de6c6bd2293a85b50b1b89312235e9c9f373fadfb02aa6837256784de071a8`。偏移均为 UTF-16 字符偏移，不是 APK/Dex 字节地址。服务端按当前 `server.js` 分支及实际注册的十个 `gameModules` 的 `commands/handledCommands` 对照；本文件是本次代码扫描快照，后续接入新模块需重新核对。

## 如何判断覆盖

协议声明表同时包含客户端请求和服务端推送。当前可解析到 247 个声明，其中 208 个名字出现在请求处理分支/模块命令集中，39 个没有；**这不是完成率**。例如 `item_update` 没有请求 handler 完全正常，另有 `item_gift_open` 推送甚至不在这 247 个声明中。反过来，handler 存在也不能证明流程、概率、动画、存档和重复请求已经正确。本次第一轮扫描为八模块、204 个名字；下列礼包与插花遗漏已在第二轮接入代码，仍需跨模块实机验收。

本次分别核对了：声明、`SocketManage.send("字面命令")` 发送点、`addProtocolCallback` 消费点、服务端主动推送点和已有模块入口。没有发现未声明且未处理的字面 send 命令；动态命令、渠道 SDK 调用及未走过的历史活动仍有分析边界。“没有字面发送点”只表示此次静态检索未发现，不能证明运行时永远不会发送。

## 对路线图闭环有直接影响的遗漏

| 协议/功能 | 确认的客户端行为 | 本次扫描状态 | 对应工作与建议 |
| --- | --- | --- | --- |
| `client_change_decorate` / 插花装饰 | `RoleModel.changeDecoration` 确实发请求，成功后调整花枝数量、摆放 ID 和生长状态；偏移 177392 | 第二轮已注册 `DecorationService`，替换仅回放旧数据的方式 | 第 3/8/14 项：验收持有花枝、选择/替换、成长、枯萎/阶段与称号/图鉴事件，不能只显示旧花枝。 |
| `item_select_gift` | 真实 UI 按 1 起始的 `index_list` 选择；请求前先把本地队列 shift；偏移 144884 | 第二轮已注册 `GiftsService` | 第 2/8/9/12 项：保留原队列、一次性预留与领取，失败推回权威队列。 |
| `item_load_select_gift` | `ItemModel` 接收 `{list:[{num,items:[{item_id,count}]}]}`，弹自选窗口 | 没有直接字面 send；第二轮已接持久自选队列 | 跟 `item_select_gift` 一并验收；不要误判成“没 handler 就缺一个请求”。 |
| 固定礼包/种子盲盒展开 | 商人成功回调专门跳过给 type 5 加库存，等待 `item_gift_open`；扭蛋真实奖励 206 为 5101 种子盲盒 | 第一轮只加死库存，第二轮 `gifts.js` 已接入统一扫描展开 | 5001/2/3 按 `GiftData_json` 精确数量；5101 两种子/5102 一种子按文字，抽取概率近似。验收实际跨模块奖励不再成为无法使用的物品。 |
| 商人礼包可见性 | 家具商店配置含 5001/5002/5003/5101，普通付费草购买与广告免费行并存 | 旧过滤只留 type 10–13；已有新过滤策略供整合 | `GiftsService.supportsShopItem` 给出已支持类型策略；保留普通食品/工具/种子/礼包，单独过滤 type 998 广告入口。 |

以上内容应优先补齐再声称对应路线图完整。礼包模块的具体形状、配置依据与测试见 [gift-protocols.md](gift-protocols.md)。

## 其他真实请求，尚未形成玩家闭环

| 命令 | 发送/回调证据 | 判断与建议 |
| --- | --- | --- |
| `tutorial_step_open_door`、`tutorial_step_open_door_q`、`tutorial_step_ask_award`、`tutorial_step_ask_award_q` | 主庭院新手 GuideStep.GetAward 连续发送，偏移约 877144–877374，查询回调读 `response.ok` | 新账号默认跳过教程，因此当前成熟存档不会触发；若目标包含正常新手流程，必须有幂等教学状态和一次性奖励，不能只返回 code0。是否开放原版新手流程需在路线图补明确验收项。 |
| `rank_load`、`rank_get_intro`、`rank_like` | `RankingModel` 实际发送；偏移约 69863、70192、70621；load 消费 info/me/first_intro，intro 消费 intro | 本地多账号可以实现排行和一次点赞，保存排名周期、脱敏资料与点赞去重；没有必要伪造官方全部玩家。与第 14 项整体玩家体验相关，现路线图未单列，应登记为额外缺口。 |
| `item_use_gift_code` | 礼包码输入页真实发送，偏移 546356；成功判断是 `code===200`，不是 code0 | 日历新呱码先由 CalendarModel 截获，不能将它与通用礼包码混为一谈。可做管理员配置的本地兑换码、账号一次性领取与审计；官方全量兑换码数据库未知，不应假称兼容官方兑换结果。 |

## 无须按缺失玩法处理的推送

| 名字 | 依据 |
| --- | --- |
| `clover_update`、`item_update`、`item_update_ticket` | 服务端按绝对余额/库存主动推送，客户端只注册消费；没有字面 request。无需给玩家开放“自己上报余额”的 handler。 |
| `clover_notice_get` | 客户端按 reason 弹奖励提示，是展示推送；奖励仍须服务器先结算。 |
| `item_gift_open` | 客户端消费开启礼包动画并显示 items；它不在本次解析的声明表中，仍应作为礼包结算后的服务端推送。 |
| `client_load_decorate` | 当前以服务端推送为主，是否缺失应看关联的 change 与成长状态机，而不是仅看没有 request handler。 |
| `mail_ejoy_active_code` | 只有声明/回调，本次未找到字面发送；含外部 ticket 语义，不应凭名字给玩家添加任意发奖请求。外部渠道可能动态调用，仍需运行证据。 |

## 外部平台、广告与支付入口

- 明确广告/分享相关：`adsmgr_share/refuse/share_ads/shop_free`、`share_get_reward`、`client_share_publicity`、微信关注/打开奖励及推送登记。按用户排除范围可以停用其平台流程，但若某奖励是非广告玩法唯一来源，仍需设计离线替代，不能让收集永久不可达。
- `client_taobao_import/draw_taobao` 依赖官方淘宝迁移接口，当前已有管理端真实数据导入，玩家侧原迁移页尚无本地对应流程；不应把后台导入当作原接口已复刻。
- `recharge_ready_pay/cancel_pay` 为支付过程；`recharge_load_gift/update_num` 是礼包/资源计数推送，单独列入无请求 handler 不代表缺少可玩内容。
- **`recharge_water` 和 `recharge_change` 不能只因前缀就认定为支付**：它们是 `RechargeModel.request_water/request_change` 的真实资源使用操作，分别关联浇水/换货。若今后允许通过本地活动取得 200003/200004 或导入账号已有这些次数，需要消费/效果闭环；如果整个付费农田/礼包页明确停用，可排除该页，但应在产品范围中写明。当前实际扭蛋配置未奖励这两个资源，不能据此推断所有来源都不存在。

`client_set_lang`、`client_user_action`、`hall_hello`、`hall_leave_game` 只有声明，本次没有字面发送点。当前握手使用 `client_hello`、`hall_gen_token/login/enter_game`。这些应保留为未确认协议，不应为了“计数满分”添加无意义成功返回。

`client_gm` 六处字面发送来自调试控制台及批量制作调试命令。普通玩家不应拥有自由 GM 权限；不支持该接口符合服务边界，不属于缺少普通玩法。

## 验收顺序

1. 优先接入礼包展开与自选队列，验证“商人买工具包 → 得到真实工具 → 可制作”“扭蛋领种子盲盒 → 得到种子 → 可种植”两个跨模块流程。
2. 插花/装饰与成长接入后，确认花枝持有量、选择、重进、阶段变化、图鉴/称号均正确。
3. 本地排行/玩家简介/点赞、原版新手流程、通用礼包码作为明确的附加验收项，不能因未列在 14 行中而遗漏。
4. 重新扫描已注册模块后逐项测试请求和客户端实际页面；这份静态清单不提供“所有功能完成”的结论。
