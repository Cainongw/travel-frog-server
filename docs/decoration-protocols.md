# 花瓶插花、花期与自然图鉴

`src/game/creative/decoration.js` 补齐 `client_load_decorate` 和 `client_change_decorate`。这里的“装饰”实际指屋内花瓶中的插花，和普通家具摆放、户外种植花盆分别存储。

## 客户端与配置确认的规则

复用已有 REA 主脚本静态证据，精确字段经普通 Node 读取热更新主脚本核对：`RoleModel.client_load_decorate` 读取 `{has_list:[{id,num}],put_id,status}`；`changeDecoration` 使用 `client_change_decorate(id)`，成功 `code=0`。客户端随后将原先花瓶里的那份花材数量减一，选中新花，status=1。

`MainInView.updateDecoration` 遍历花材列表，根据 `put_id` 和 `decoration_json.pic[status-1]` 更新花瓶图片。`FlowerPotView` 选择花材前弹窗明确说明：若瓶中有花，则丢弃原花材。该列表与普通仓库分开：真实采集有 `{id:1004,num:2}`、`{id:10021,num:1}`，对应物品 202106/202221 的仓库数量均为零。

最新 `decoration_json` 有 32 种花材，全部可以按同名映射到真实 type14 物品。蜡梅为装饰 ID100 / 物品202101，木槿为 ID101 / 物品202102。它们的两个图像分别为花苞与开花；配置 `achieve` 为 `DECO_LM` / `DECO_MJ`，称号73/74和79/80的说明分别要求这两阶段。

**这些花不是管理员强制赠送才可取得。** 家具商店真实配置有蜡梅商品8、木槿商品9，各288草，type999，非广告；另有300草商品8010/8011。7022/7023为type998广告福利，默认不应作为无需广告的普通购买入口。商店整合需放行可插花物品，购买后库存转入花材列表。

## 本地实现

- 从原始采集保留花材数量、当前插花和阶段，不改原始协议归档。
- 获得对应真实物品后，`advance` 或加载请求将其从仓库转到花材列表，并推绝对库存数量。重复推进不重复转入。
- 插入花材时保留该份在 has_list 内；替换、主动清空或到期时，丢弃旧花一份。未知或未拥有的花材被拒绝；重复选择当前花材不会重置花期或重复扣除。
- 新插入 status1，默认六小时后 status2，两日后从花瓶移除。绝对时间保存在模块状态，离线时按截止时间推进。
- 花期是本地近似。蜡梅、木槿阶段2图像为开花；部分栽培花材阶段2资源带 `_kw`，视觉是凋萎，服务统一视作第二展示阶段，不宣称全部花都在阶段2“盛开”。
- 通过 `stage_history:[{id,stage,at,source}]` 记录真实发生或原始采集确认的阶段；拥有记录另存 `owned_history`。即使替换/枯萎，历史观测仍在，供称号条件使用。

模块不直接强制赋予称号。`ProgressionService` 观察真实阶段历史后按配置解锁73/74/79/80。`encyclopediaObservations` 根据花材图标与实际阶段图片精确匹配百科配置 `pic_img`，返回真实 `long_id`；拥有只支持主图，达到插花阶段后才支持对应插花图，不自动解锁未经历的生长图。

## 接口

```js
const {DecorationService}=require('./src/game/creative/decoration');
const decoration=new DecorationService(database,catalog,{bloomSeconds:21600,lifeSeconds:172800});
```

同其他模块提供 `commands`、`initial`、`handle -> {response,events}`、`advance -> {changed,events}`。状态直接存储在 `game_module_state` 的 `decoration` 行，顶层含 `has_list/put_id/status/started_at/bloom_at/expires_at/stage_history/owned_history/discarded`。

主服务应包装角色投影：`decoration.decorateRole(account,role)` 将 `role.frog.decoration` 更新为当前花材列表，防止后续角色同步把原生列表清空。成功响应后再发推送，避免客户端本地“减旧花、设置新花”回调覆盖权威状态。

客户端旧 `MainInView.updateDecoration` 在空瓶时不会清空 `flower.source`，导致到期后残留旧图。本次 `tools/android/patches/client_policy_patch.js` 额外只包装这个实际方法：先执行原方法，再在无有效选中花材时清图，保留普通插花显示和返回值；重复追加安全。需要后续 APK 追加补丁并实机验证。

## 验证与边界

`node --test tests/decoration_test.js` 六项通过：原始采集和仓库转花材不重复；花苞/开花/替换/到期闭环；非法和未拥有选择拒绝；重新建立服务与完整快照恢复；写入失败事务回滚；真实配置32种花材身份和蜡梅百科阶段图匹配。

`node --test tests/client_policy_patch_test.js` 三项通过，额外覆盖空瓶残影清除、有效插花不被误清、原方法返回值和重复包装。

尚需主流程实机验证商人购花、花瓶选择、阶段图片、替换与到期清图，以及相应称号和百科推送。花期与丢弃策略属于明确近似，未声称恢复官方隐藏计时算法。
