<script>
  import { buildRecipeParcel, furnitureLabel } from './garden.js';
  export let catalog;
  export let snapshot;
  export let garden = null;
  export let busy = false;
  export let onAction;

  let furnitureSearch = '';
  let selectedFurnitureId = null;
  let selectedSlot = 1;
  let benchItemId = null;
  let ownedFurnitureId = null;
  const date = value => value ? new Date(value * 1000).toLocaleString('zh-CN', { hour12: false }) : '—';
  const duration = seconds => {
    const value = Math.max(0, Number(seconds) || 0);
    if (value >= 3600) return `${Math.floor(value / 3600)} 小时${value % 3600 ? ' ' + Math.ceil(value % 3600 / 60) + ' 分钟' : ''}`;
    return value >= 60 ? `${Math.ceil(value / 60)} 分钟` : `${value} 秒`;
  };
  $: itemName = id => catalog.items.find(item => item.id === id)?.name || `物品 #${id}`;
  $: inventory = garden?.inventory || snapshot.items.house;
  $: stock = id => inventory.find(item => item.item_id === id)?.count || 0;
  $: furnitureName = id => furnitureLabel(catalog, id);
  $: furnitureCatalog = catalog.furniture || [];
  $: matchingFurniture = furnitureCatalog.filter(item => `${item.id} ${item.name}`.toLowerCase().includes(furnitureSearch.toLowerCase()));
  $: selectedFurniture = furnitureCatalog.find(item => item.id === Number(selectedFurnitureId)) || matchingFurniture[0] || null;
  $: state = garden?.furniture;
  $: neighbor = garden?.neighbor;
  $: job = state?.job;
  $: owned = state?.has_fur || [];
  $: if (!owned.includes(Number(ownedFurnitureId))) ownedFurnitureId = owned[0] ?? null;
  $: bench = Array.from({ length: 10 }, (_, index) => state?.bench?.[index] ?? -1);
  $: benchOptions = catalog.items.filter(item => item.type === (selectedSlot <= 5 ? 12 : 11) && stock(item.id) > 0);
  $: if (!benchOptions.some(item => item.id === Number(benchItemId))) benchItemId = benchOptions[0]?.id ?? null;
  $: merchantItems = (state?.shop?.shop_list || []).map(entry => ({ ...entry, config: (catalog.furnitureShop || []).find(item => item.id === entry.shop_id) }));
  $: recipeParcel = buildRecipeParcel(selectedFurniture, inventory, bench);
  async function sendRecipe() {
    if (!selectedFurniture || !recipeParcel.length || recipeParcel.some(item => item.count > 99)) return;
    await onAction('mail', {
      title: `${selectedFurniture.name} · 制造补给`,
      message: '这份邮件包含当前缺少的图纸、素材或工具。领取后，可在工作台准备制造。',
      items: recipeParcel,
    }, '制造补给邮件已寄出，领取后入库。');
  }
  function putBench(event) {
    event.preventDefault();
    if (benchItemId === null) return;
    onAction('furniture-put', { pos: Number(selectedSlot), id: Number(benchItemId) }, '物品已放入工作台。');
  }
</script>

<div class="section-intro">
  <div><p class="eyebrow">A HOME BETWEEN JOURNEYS</p><h2>把小屋，慢慢布置成家。</h2></div>
  <p>查看制造进度与庭院来客，<br />为下一次相聚做好准备。</p>
</div>

{#if !garden}
  <section class="panel"><p class="empty-small">庭院状态尚未加载，请刷新服务器状态后再试。</p></section>
{:else}
  <div class="two-columns garden-top">
    <section class="panel">
      <div class="panel-heading"><h2>制造中的小日常</h2><span>WORKSHOP</span></div>
      {#if job}
        <div class="craft-job"><span class="tag">制造中</span><h3>{furnitureName(job.furniture_id)}</h3><dl><div><dt>开始时间</dt><dd>{date(job.started_at)}</dd></div><div><dt>预计完成</dt><dd>{date(job.finish_at)}</dd></div><div><dt>本次耗时</dt><dd>{duration(job.finish_at - job.started_at)}</dd></div></dl></div>
        <div class="garden-actions"><button class="primary" onclick={() => onAction('furniture-advance', {}, '已检查并结算到期的制造任务。')} disabled={busy}>结算到期任务</button><button class="secondary" onclick={() => onAction('furniture-finish', {}, '制造已立即完成（管理员操作）。')} disabled={busy}>立即完成 · 测试</button></div>
      {:else}
        <div class="craft-idle"><span>⌂</span><h3>工作台正在等一个新想法。</h3><p>准备好图纸、素材和工具，再检查制造进度。</p></div>
        <button class="primary" onclick={() => onAction('furniture-advance', {}, '已检查工作台与制造进度。')} disabled={busy}>检查制造进度</button>
      {/if}
      <p class="footnote">当前配方和耗时是离线近似规则，APK 未包含完整的官方制造规则。普通结算仅处理到期任务；测试操作会提前完成。</p>
    </section>
    <section class="panel">
      <div class="panel-heading"><h2>邻居来做客</h2><span>NEIGHBORS</span></div>
      {#if neighbor && neighbor.id >= 0}
        <div class="neighbor-profile"><span class="avatar">{(catalog.neighbors || []).find(item => item.id === neighbor.id)?.name?.slice(0, 1) || '邻'}</span><div><h3>{(catalog.neighbors || []).find(item => item.id === neighbor.id)?.name || '邻居 #' + neighbor.id}</h3><span class="tag">{neighbor.served ? '已经喂食' : '等待招待'}</span><span class="tag">{neighbor.confirmed ? '已见面' : '待见面'}</span></div></div>
        <p class="muted">预计离场：{date(neighbor.expire_time)}</p>
        <p class="muted">在游戏庭院里点击邻居，可用库存中的特产喂食。</p>
        <button class="secondary" onclick={() => onAction('neighbor-depart', {}, '邻居已离场，奖励按服务端规则结算。')} disabled={busy}>让邻居离场</button>
      {:else}
        <div class="craft-idle"><span>♧</span><h3>庭院里暂时很安静。</h3><p>安排一位邻居来访，在客户端准备一份特产招待。</p></div>
        <button class="secondary" onclick={() => onAction('neighbor-arrive', {}, '已安排邻居来访。')} disabled={busy}>安排邻居来访</button>
      {/if}
    </section>
  </div>
  <section class="panel workbench-panel">
    <div class="panel-heading"><h2>工作台</h2><span>{state?.bench_lock ? '制造中 · 已锁定' : '准备中'}</span></div>
    <div class="bench-groups">{#each [{name:'工具槽',start:0},{name:'特殊素材槽',start:5}] as group}<div><p>{group.name}</p><div class="bench-slots">{#each bench.slice(group.start, group.start + 5) as id, index}<button class:selected={selectedSlot === group.start + index + 1} disabled={busy || state?.bench_lock} onclick={() => selectedSlot = group.start + index + 1}><small>{group.start + index + 1}</small><span>{id >= 0 ? itemName(id) : '空位'}</span>{#if id >= 0}<code>#{id}</code>{:else}<b>＋</b>{/if}</button>{/each}</div></div>{/each}</div>
    <form class="bench-form" onsubmit={putBench}><label>放入第 {selectedSlot} 槽 · {selectedSlot <= 5 ? '工具' : '特殊素材'}<select bind:value={benchItemId} disabled={busy || state?.bench_lock || !benchOptions.length}>{#each benchOptions as item}<option value={item.id}>{item.name} · 库存 {stock(item.id)}</option>{:else}<option value={null}>没有可放入的库存物品</option>{/each}</select></label><button class="primary" disabled={busy || state?.bench_lock || benchItemId === null}>放入工作台</button><button type="button" class="secondary" onclick={() => onAction('furniture-take', { pos: Number(selectedSlot) }, '物品已从工作台取回。')} disabled={busy || state?.bench_lock || bench[selectedSlot - 1] < 0}>取出物品</button></form>
    <small>第 1–5 槽用于家具工具，第 6–10 槽用于特殊素材。普通素材由库存提供，制作中的工作台不能更改。</small>
  </section>
  <div class="two-columns garden-owned">
    <section class="panel"><div class="panel-heading"><h2>已经做好的家具</h2><span>{owned.length} 件</span></div>{#if owned.length}<form onsubmit={event => { event.preventDefault(); onAction('furniture-replace', { id: Number(ownedFurnitureId) }, '家具已摆放。'); }}><label>选择已拥有的家具<select bind:value={ownedFurnitureId}>{#each owned as id}<option value={id}>{furnitureName(id)} · #{id}</option>{/each}</select></label><button class="primary" disabled={busy}>摆放家具</button></form>{:else}<p class="empty-small">还没有做好的家具。</p>{/if}<div class="placed-list"><h3>当前摆放</h3>{#each state?.put_fur || [] as item}<div><small>位置 {item.type}</small><span>{furnitureName(item.id)}</span></div>{:else}<p class="muted">暂无摆放记录。</p>{/each}</div></section>
    <section class="panel"><div class="panel-heading"><h2>家具商人</h2><span>SHOP</span></div><div class="merchant-list">{#each merchantItems as item}<div class="merchant-item"><div><strong>{item.config?.name || itemName(item.config?.item_id)}</strong><small>{item.config?.price ?? '—'} 棵三叶草 · 剩余 {item.num}</small></div><button class="secondary" disabled={busy || !item.config || item.num <= 0 || snapshot.account.clover < item.config.price} onclick={() => onAction('furniture-buy', { shop_id: item.shop_id }, '家具商人商品已购买。')}>购买</button></div>{:else}<p class="empty-small">商人当前没有可购买的商品。</p>{/each}</div></section>
  </div>
{/if}

<section class="panel">
  <div class="panel-heading"><h2>家具目录</h2><span>{furnitureCatalog.length} 种家具</span></div>
  {#if !furnitureCatalog.length}
    <div class="empty-small">暂时没有家具配置。请确认服务器已加载 APK 家具目录。</div>
  {:else}
    <div class="garden-catalog">
      <div class="furniture-picker">
        <label>查找家具<input bind:value={furnitureSearch} placeholder="名称或家具编号…" /></label>
        <div class="furniture-options">
          {#each matchingFurniture as furniture}
            <button class:selected={selectedFurniture?.id === furniture.id} onclick={() => selectedFurnitureId = furniture.id}>
              <span>{furniture.name}</span><small>#{furniture.id}</small>
            </button>
          {:else}<p class="empty-small">没有找到匹配的家具。</p>{/each}
        </div>
      </div>
      {#if selectedFurniture}
        <div class="furniture-recipe">
          <div class="recipe-title"><span class="tag">家具 #{selectedFurniture.id}</span><h3>{selectedFurniture.name}</h3><p class="muted">制造时间 · {duration(selectedFurniture.time)}</p></div>
          <h3>所需素材</h3>
          <div class="table-wrap"><table><thead><tr><th>物品</th><th>需求</th><th>库存</th></tr></thead><tbody>
            {#each selectedFurniture.material || [] as item}<tr><td>{itemName(item.item_id)}</td><td>× {item.count}</td><td class:stock-short={stock(item.item_id) < item.count}>{stock(item.item_id)}</td></tr>{:else}<tr><td colspan="3" class="empty-small">无需素材</td></tr>{/each}
          </tbody></table></div>
          <h3 class="recipe-tools-heading">可用工具 · 任选一种</h3>
          <div class="province-list">{#each selectedFurniture.tool || [] as id}<span class="tag">{itemName(id)} · {bench.includes(id) ? '已在工作台' : stock(id) ? '已拥有' : '未拥有'}</span>{:else}<span class="muted">无需工具</span>{/each}</div>
          {#if Number.isSafeInteger(selectedFurniture.paper_item_id)}<div class="recipe-paper"><span>图纸</span><strong>{itemName(selectedFurniture.paper_item_id)}</strong><small>库存 {stock(selectedFurniture.paper_item_id)}</small></div>{/if}
          <div class="recipe-parcel"><h3>补齐缺少的物品</h3>{#if recipeParcel.length}<p>{recipeParcel.map(item => `${itemName(item.item_id)} × ${item.count}`).join('、')}</p><button class="secondary" onclick={sendRecipe} disabled={busy || recipeParcel.some(item => item.count > 99)}>寄出制造补给</button>{#if recipeParcel.some(item => item.count > 99)}<p class="footnote">单项需求超过 99，请通过“礼物与邮件”分批寄送。</p>{/if}{:else}<p>图纸、素材与工具已经备齐。</p>{/if}<small>计算库存与工作台中的现有数量，只寄送缺少部分。工具任选一种，均未拥有时补发列表中的第一种；领取邮件后入库。</small></div>
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  .garden-catalog{display:grid;grid-template-columns:minmax(180px,.8fr) minmax(0,1.5fr);gap:28px}
  .furniture-picker label{font-size:12px}
  .furniture-options{max-height:430px;overflow:auto;padding-right:4px}
  .furniture-options button{display:flex;align-items:center;justify-content:space-between;width:100%;gap:12px;padding:11px 12px;border:1px solid transparent;background:none;color:#6f8262;border-radius:6px;text-align:left;font-size:12px;margin-bottom:4px}
  .furniture-options button:hover,.furniture-options button.selected{background:#edf2e3;border-color:#d8e3cc;color:#41603a}
  .furniture-options button small{font-size:10px;color:#99a58b}
  .furniture-recipe{border-left:1px solid #e5e9dc;padding-left:28px}
  .recipe-title{margin-bottom:24px}
  .recipe-title h3{font-family:"STSong","SimSun",serif;font-size:24px;margin:12px 0 8px;color:#4c673f;font-weight:500;letter-spacing:1px}
  .furniture-recipe>h3{font-size:12px;color:#7b8b6d}
  .recipe-tools-heading{margin-top:25px}
  .furniture-recipe .province-list{margin-top:8px;font-size:12px}
  .stock-short{color:#a56642}
  .garden-top,.garden-owned{margin-bottom:24px}
  .craft-job h3{font-family:"STSong","SimSun",serif;font-size:24px;color:#4c673f;font-weight:500;margin:12px 0 15px}
  .craft-job dl{margin:0 0 22px;font-size:12px}
  .craft-job dl>div{display:flex;justify-content:space-between;gap:15px;border-bottom:1px dashed #e4e8db;padding:8px 0}
  .craft-job dt{color:#95a086;white-space:nowrap}.craft-job dd{margin:0;color:#708363;text-align:right}
  .garden-actions{display:flex;flex-wrap:wrap;gap:10px}.garden-actions button{font-size:11px;padding:9px 13px}
  .craft-idle{padding:8px 0 20px}.craft-idle>span{font-size:32px;color:#9fb48b}.craft-idle h3{font-family:"STSong","SimSun",serif;font-size:19px;font-weight:500;letter-spacing:1px;margin-top:8px;color:#6b8557}.craft-idle p{color:#95a086;font-size:11px;margin-bottom:0}
  .neighbor-profile{display:flex;align-items:center;gap:15px;margin:10px 0 22px}.neighbor-profile .avatar{width:52px;height:52px;font-size:24px}.neighbor-profile h3{font-size:17px;font-weight:500;letter-spacing:2px;margin-bottom:7px}.neighbor-profile .tag{margin-right:5px}
  .bench-groups{display:grid;grid-template-columns:1fr 1fr;gap:24px}.bench-groups>div>p{font-size:11px;color:#95a086;margin-bottom:10px}.bench-slots{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px}.bench-slots button{border:1px dashed #d6dfca;background:#f7f8ef;border-radius:6px;padding:8px 5px;min-height:90px;position:relative;color:#97a38b;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px}.bench-slots button.selected{border:1px solid #7c9b65;background:#edf3e2;color:#52733f}.bench-slots small{position:absolute;left:6px;top:3px;font-size:8px;color:#a9b59c}.bench-slots span{font-size:10px;line-height:1.5;padding-top:11px;overflow-wrap:anywhere}.bench-slots code{font-size:8px;color:#a3b292}.bench-slots b{font-size:14px;font-weight:400;line-height:1.2}.bench-form{display:flex;align-items:end;gap:10px;margin:25px 0 12px}.bench-form label{flex:1;margin:0;min-width:0;font-size:11px}.bench-form select{font-size:12px}.bench-form button{margin:0;font-size:11px;padding:10px 13px;white-space:nowrap}.workbench-panel>small{font-size:10px}
  .placed-list{border-top:1px dashed #e3e8d9;margin-top:24px;padding-top:17px}.placed-list h3{font-size:11px;color:#8d9b7b}.placed-list>div{display:flex;align-items:center;gap:14px;padding:8px 0;color:#6f8460;font-size:12px}.placed-list small{font-size:10px}.placed-list p{font-size:11px;margin-bottom:0}
  .merchant-list{max-height:380px;overflow:auto}.merchant-item{display:flex;align-items:center;justify-content:space-between;gap:14px;border-bottom:1px solid #edf0e5;padding:13px 0}.merchant-item:first-child{padding-top:0}.merchant-item:last-child{border-bottom:0}.merchant-item strong{font-size:12px;display:block;font-weight:500;color:#617b50}.merchant-item small{font-size:10px;display:block;margin-top:3px}.merchant-item button{font-size:11px;min-height:35px;padding:6px 12px}
  .recipe-paper{margin-top:24px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;font-size:11px;padding:14px;background:#f2f5e8;border-radius:5px;color:#7e936d}.recipe-paper strong{font-size:12px;font-weight:500}.recipe-paper small{margin-left:auto;font-size:10px}
  .recipe-parcel{margin-top:24px;padding-top:22px;border-top:1px dashed #dde5d1}.recipe-parcel h3{font-size:12px;color:#71875e}.recipe-parcel p{font-size:11px;color:#9aa58e;margin-bottom:15px;line-height:1.9}.recipe-parcel>small{font-size:10px;display:block;margin-top:15px;line-height:1.9}
  @media(max-width:1180px){.bench-groups{grid-template-columns:1fr;gap:18px}.bench-slots button{min-height:77px}}
  @media(max-width:850px){.garden-catalog{grid-template-columns:1fr}.furniture-options{max-height:180px}.furniture-recipe{padding:20px 0 0;border-left:0;border-top:1px solid #e5e9dc}.bench-form{flex-wrap:wrap}.bench-form label{flex-basis:100%;margin-bottom:3px}.bench-form button{flex:1}.garden-top,.garden-owned{gap:17px}}
  @media(max-width:580px){.bench-groups{gap:15px}.bench-slots{gap:6px}.bench-slots span{font-size:9px}.bench-slots button{min-height:80px}.craft-job h3{font-size:22px}.craft-job dl>div{font-size:11px}}
</style>
