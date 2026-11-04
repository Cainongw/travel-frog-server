# 原生抽奖协议核对

分析对象为解压 APK 的 `assets/game/js/main.min.js` 与
`assets/game/resource/China/eab/config.eab`。配置由 `catalog.js` 解码，未执行 APK 脚本。

## 已确认的客户端行为

| 入口 | 源码证据 | 服务器行为 |
| --- | --- | --- |
| `item.gacha` | 协议表参数 `is_reward`，需要 session 回包；`RaffleView.raffle` 使用 `RAFFEL_NEEDTICKETS=5` | 普通抽奖扣 5 张券 |
| 抽奖结果 | `ItemModel.item_gacha(e)` 执行 `gachaColorBall=e.ticket` | 回包 `ticket` 是颜色编号，**不是券余额** |
| 颜色 | `Prize.Rank` 白/青/紫/绿/红/黄分别为 0–5 | 使用 `[40,25,22,9,3,1]` 权重，与客户端 `PrizeBalls` 一致；这不是已恢复的官方服务器概率实现 |
| 尚未兑奖 | `item_load_items` 读取 `gacha.color_ball`；打开抽奖界面检查已有颜色 | 抽奖结果持久化，重连后继续兑奖 |
| 白球 | `RaffleView.updateGachaColorBall` 的白球分支：`addTicket(prize.stock)` 并发送 `item_redeem_prize(prize.id)` | 按配置返还券；当前 APK 的奖项 0 返还 1 张券，不能按 `PrizeClover` 常量发草 |
| 其他球 | `PrizeSelector` 只列出 `Prize.rank` 相同的选项，按 `itemId/stock` 领取 | 后端再次校验奖项存在、颜色匹配；发配置指定道具 |
| `item.redeem_prize` | 参数 `prize_id`，协议表无 session | 结算后推送库存/券余额，重复兑奖不得再次发奖 |
| 本地加减 | 此版本 `UserModel.addTicket`、`ItemModel.addHouseItem` 为空函数；`consumeTicket` 只检查够不够 | 必须推送绝对余额 `item_update_ticket` 和绝对数量 `item_update` |
| 奖励抽奖 | `reward_raffle()` 发 `is_reward:true`；邮件的 `resource.reward_gacha` 可打开该界面 | 免费机会必须由可信奖励结算记账，不能信任客户端布尔值直接免费抽 |

当前配置有 23 个奖项，消费 `catalog.prizes` 和 `catalog.items`。没有完整配置时拒绝抽奖并保留券。素材未提供时不会用虚构奖项替代。

## 接入

`gameplay.js` 不导入 `database.js`，可以在持久层安全引用辅助方法：

```js
const { migrateGameplay, getGachaState, importGachaState, grantGachaCredits } = require('./gameplay');
```

1. `FrogDatabase.migrate()` 创建 accounts 后调用 `migrateGameplay(this)`，创建独立 `gacha_state` 表。
2. `getItemState(account)` 的 `gacha` 改为 `getGachaState(this, account)`。现有导出已经包含 `items`，因此会一起备份 `color_ball`、`reward_credits` 和 `draw_count`。
3. 在 `importAccount` 事务内调用 `importGachaState(this, account, snapshot.items?.gacha || {})`。当前 SQLite schema 与 JSON 导出为 v5，`items.gacha` 包含待兑球、免费次数和抽奖计数；v1–v4 旧存档缺失这些可选字段时默认没有待兑球和免费机会。该函数进行整数/范围校验。
4. 如果支持含 `resource.reward_gacha` 的邮件，在 `openMail` 成功更新邮件为已领取的**同一事务内**，调用 `grantGachaCredits(this, account, count)`。重复开信不能新增次数。客户端无法直接调用此可信记账辅助函数。

服务器创建服务：

```js
const { GameplayService } = require('./gameplay');
const gameplay = new GameplayService(database, catalog);
```

请求适配：

```js
case 'item_gacha': {
  const result = gameplay.draw(account, data.is_reward);
  sendEvent(client, 'item_update_ticket', { ticket: result.ticket_balance });
  if (!result.ok) sendEvent(client, 'client_notice', { msg: result.reason });
  return { code: result.ok ? 0 : 1, ticket: result.rank };
}
case 'item_redeem_prize': {
  const result = gameplay.redeem(account, data.prize_id);
  sendEvent(client, 'item_update_ticket', { ticket: result.ticket_balance });
  for (const item of result.itemChanges) sendEvent(client, 'item_update', { item });
  return { code: result.ok ? 0 : 1 };
}
```

`item_gacha` 的 session 回包会自动触发 `ItemModel.item_gacha`，不要再发送同名推送导致重复播放。未兑球存在时重复抽奖返回原来的颜色和余额，不再次扣券。兑奖成功后将待兑颜色清空；不存在待兑球时拒绝兑奖。

旧协议的兑奖命令只有 `prize_id`，没有 draw ID 或持久的请求 UUID。现实现保证“无待兑球时重发兑奖不再发奖”，但不能区分“上一轮同色奖项的迟到请求”和“当前一轮同色奖项的新兑奖”。若要进一步跨连接去重，需要客户端协议补充行程式的抽奖流水号；不能宣称当前协议提供任意时序下的全局幂等。

## 验证

```powershell
node --test gameplay_test.js
```

覆盖扣 5 券且 pending 重发不重复消费、错误颜色/非法奖项拒绝、白球返券、跨账号隔离、库存结算中途失败回滚、免费机会一次性消费、资料缺失不扣券、待兑球跨重启保留、导入状态验证，以及本地 APK 的 6 色奖项配置完整性。所有测试使用内存库或单独临时 SQLite，不触碰真实存档。
