<script>
  import { api } from './api.js';
  export let account;
  export let page = { snapshots: [], next_cursor: null };
  export let busy = false;
  export let onAction;
  let label = '', target = null, confirmation = '', acknowledged = false;
  let extra = [], cursor = null, moreBusy = false, error = '', generation = 0;
  $: if (page) { extra = []; cursor = page.next_cursor; target = null; confirmation = ''; acknowledged = false; error = ''; generation++; }
  $: entries = [...page.snapshots, ...extra];
  const date = seconds => new Date(seconds * 1000).toLocaleString('zh-CN', { hour12:false });
  async function create(event) {
    event.preventDefault();
    if (await onAction('snapshot-create',{label},'快照已创建。')) label = '';
  }
  function select(entry) { target = entry; confirmation = ''; acknowledged = false; error = ''; }
  async function restore(event) {
    event.preventDefault();
    if (!target || confirmation !== account || !acknowledged) return;
    const result = await onAction('snapshot-restore',{snapshot_id:target.id,confirm_account:confirmation},'回档已完成，回档前状态已生成保护快照；游戏客户端需重新连接。');
    if (result) { target = null; confirmation = ''; acknowledged = false; }
  }
  async function more() {
    const current = generation;
    moreBusy = true; error = '';
    try {
      const result = await api('snapshots',account,{query:{before:cursor}});
      if (current === generation) { extra = [...extra,...result.snapshots]; cursor = result.next_cursor; }
    } catch (e) { if (current === generation) error = e.message; }
    finally { moreBusy = false; }
  }
</script>

<section class="panel snapshots">
  <div class="panel-heading"><h2>存档快照</h2><span>SNAPSHOTS</span></div>
  <p class="muted">手动保存当前账号的完整状态，之后可选择任一快照回档。官方导入账号首次创建快照后自动解除只读，回档后也可继续测试。</p>
  <form class="create-snapshot" onsubmit={create}>
    <label>快照名称（可选）<input bind:value={label} maxlength="100" placeholder="例如：出发前、导入后的原始存档" disabled={busy || moreBusy} /></label>
    <button class="primary" disabled={busy || moreBusy}>创建快照</button>
  </form>
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  <div class="table-wrap"><table>
    <thead><tr><th>快照</th><th>创建时间</th><th>类型</th><th>内容摘要</th><th>操作</th></tr></thead>
    <tbody>{#each entries as entry (entry.id)}<tr>
      <td><strong>{entry.label}</strong><small class="snapshot-id">#{entry.id}</small></td>
      <td>{date(entry.created_at)}</td>
      <td><span class="tag">{entry.kind === 'before_restore' ? '回档前保护' : '手动创建'}</span></td>
      <td>{entry.summary.frog_name} · 草 {entry.summary.clover} / 券 {entry.summary.ticket}<br /><small>图片 {entry.summary.postcards} · 物品 {entry.summary.inventory} · 笔记 {entry.summary.notes}{entry.summary.official ? ' · 官方导入' : ''}</small></td>
      <td><button class="secondary" disabled={busy || moreBusy} onclick={() => select(entry)}>选择回档 #{entry.id}</button></td>
    </tr>{:else}<tr><td colspan="5" class="empty-small">还没有快照。点击“创建快照”保存当前状态。</td></tr>{/each}</tbody>
  </table></div>
  {#if cursor}<button class="text-button" disabled={busy || moreBusy} onclick={more}>{moreBusy ? '加载中…' : '加载更早的快照'}</button>{/if}
  {#if target}
    <form class="restore-snapshot" onsubmit={restore}>
      <h3>回档到 #{target.id} · {target.label}</h3>
      <p>将用 {date(target.created_at)} 的状态替换账号 <code>{account}</code>。服务器会先创建当前状态的保护快照，可用它撤销这次回档。</p>
      <label>输入账号标识确认回档<input bind:value={confirmation} autocomplete="off" disabled={busy} required /></label>
      <label class="checkbox"><input type="checkbox" bind:checked={acknowledged} disabled={busy} />我确认回档此账号，并让其在线游戏重新连接</label>
      <div class="actions"><button class="danger" disabled={busy || confirmation !== account || !acknowledged}>确认回档</button><button type="button" class="secondary" disabled={busy} onclick={() => target = null}>取消</button></div>
    </form>
  {/if}
  <p class="footnote">不会定时创建或自动回档。快照保存在服务器 SQLite 中，不包含 APK、图片素材和管理密钥。任务时间保留原值，重新进入游戏后，已到期的旅行或制作仍按现有规则结算。</p>
</section>

<style>
  .snapshots{margin-bottom:24px}.create-snapshot{display:flex;align-items:end;gap:14px;margin:22px 0}.create-snapshot label{flex:1;margin:0}.create-snapshot button{margin:0;white-space:nowrap}.snapshot-id{display:block}.restore-snapshot{margin-top:22px;padding:20px;border:1px solid #e3cbb9;border-radius:8px;background:#fcf8f0}.restore-snapshot h3{color:#884d37}.actions{display:flex;gap:12px}.footnote{margin:20px 0 0}.table-wrap{max-height:480px;overflow:auto}@media(max-width:620px){.create-snapshot{align-items:stretch;flex-direction:column}.restore-snapshot{padding:14px}}
</style>
