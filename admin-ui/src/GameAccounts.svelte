<script>
  import { onMount, tick } from 'svelte';
  import { api } from './api.js';

  export let busy = false;
  export let selected = '';
  let users = [], accounts = [], loaded = false;
  let search = '', username = '', password = '', account = '';
  let target = null, resetPassword = '', confirmation = '', acknowledged = false;
  let editor;
  let error = '', notice = '';

  $: filteredUsers = users.filter(user => `${user.username} ${user.account} ${frogName(user.account)}`.toLowerCase().includes(search.toLowerCase()));
  $: activeUsers = users.filter(user => !user.disabled).length;
  $: sessions = users.reduce((sum, user) => sum + Number(user.session_count || 0), 0);
  const date = value => value ? new Date(value * 1000).toLocaleString('zh-CN', { hour12: false }) : '尚无记录';
  const actionNames = { 'reset-password': '重置密码', 'set-disabled': '更改登录状态', 'revoke-sessions': '退出所有设备', delete: '删除登录账号' };
  function frogName(value) { return accounts.find(entry => entry.account === value)?.frog_name || value; }

  async function readUsers() {
    const data = await api('game-users');
    users = data.users; accounts = data.accounts; loaded = true;
    if (!account) account = accounts.some(entry => entry.account === selected) ? selected : accounts[0]?.account || '';
  }
  export async function refresh() {
    busy = true; error = '';
    try { await readUsers(); }
    catch (e) { error = e.message; }
    finally { busy = false; }
  }
  onMount(() => { refresh(); });

  async function choose(user, action) {
    target = { user, action }; resetPassword = ''; confirmation = ''; acknowledged = false; error = ''; notice = '';
    await tick(); editor?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function cancel() { target = null; resetPassword = ''; confirmation = ''; acknowledged = false; }
  async function run(body, message, onSuccess) {
    if (busy) return;
    busy = true; error = ''; notice = '';
    let committed = false;
    try {
      await api('game-users', null, { body });
      committed = true; onSuccess(); notice = message;
      await readUsers();
    } catch (e) { error = committed ? `操作已保存，但刷新列表失败：${e.message}` : e.message; }
    finally { busy = false; }
  }
  async function create(event) {
    event.preventDefault();
    await run({ action: 'create', username: username.trim(), password, account }, '登录账号已创建，可以在游戏中使用。', () => { username = ''; password = ''; });
  }
  async function apply(event) {
    event.preventDefault();
    if (!target) return;
    const { user, action } = target;
    if (action === 'delete' && (confirmation !== user.username || !acknowledged)) return;
    const body = { action, username: user.username };
    if (action === 'reset-password') body.password = resetPassword;
    if (action === 'set-disabled') body.disabled = !user.disabled;
    const message = action === 'reset-password' ? '密码已重置，原设备需重新登录。'
      : action === 'set-disabled' ? (user.disabled ? '登录账号已启用。' : '登录账号已禁用，已有登录凭据已撤销。')
      : action === 'revoke-sessions' ? '所有设备的登录凭据已撤销，需重新登录。'
      : '登录账号已删除，关联的游戏存档仍然保留。';
    await run(body, message, cancel);
  }
</script>

<div class="section-intro">
  <div><p class="eyebrow">A KEY TO EACH LITTLE HOME</p><h2>管理进入游戏的账号。</h2></div>
  <p>游戏账号关联存档。<br />管理台使用 Authentik 身份登录。</p>
</div>

{#if error}<div class="notice error" role="alert">{error}</div>{/if}
{#if notice}<div class="notice success" role="status">{notice}</div>{/if}

<div class="two-columns account-top">
  <section class="panel">
    <div class="panel-heading"><h2>创建游戏登录账号</h2><span>NEW LOGIN</span></div>
    <p class="muted">选择已有存档，设置登录名和密码。需要新存档时，先在左侧“新建本地账号”创建。</p>
    <form onsubmit={create}>
      <fieldset disabled={busy || !loaded}>
        <label>登录账号<input bind:value={username} pattern="[a-zA-Z0-9_.@-]{3,64}" maxlength="64" autocomplete="off" placeholder="例如 dog，3–64 位字母、数字或 _.@-" required /></label>
        <label>关联存档<select bind:value={account} required disabled={!accounts.length}>{#each accounts as entry}<option value={entry.account}>{entry.frog_name} · {entry.account}</option>{/each}</select></label>
        <label>初始密码<input type="password" bind:value={password} minlength="10" maxlength="128" autocomplete="new-password" required /></label>
        <small>密码至少 10 位。创建成功后请告知使用者，管理台不会展示已保存的密码。</small>
        <button class="primary" disabled={!accounts.length}>{busy ? '正在处理…' : '创建登录账号'}</button>
      </fieldset>
    </form>
  </section>
  <section class="panel account-summary">
    <div class="panel-heading"><h2>账号与存档</h2><span>ACCESS</span></div>
    <dl><div><dt>登录账号</dt><dd>{users.length}<small> 个</small></dd></div><div><dt>已启用</dt><dd>{activeUsers}<small> 个</small></dd></div><div><dt>有效登录凭据</dt><dd>{sessions}<small> 份</small></dd></div></dl>
    <p class="muted">多个登录账号可关联同一份存档，游戏进度会共用。请按使用者的需要分配。</p>
    <p class="muted">禁用账号、重置密码或退出设备会使登录凭据失效；删除登录账号会保留存档，可再创建账号关联它。</p>
    <p class="footnote">凭据数量反映仍有效的登录会话，不代表设备当前在线。这里管理游戏登录，Authentik 管理员权限仍由统一身份系统控制。</p>
  </section>
</div>

<section class="panel">
  <div class="panel-heading"><h2>游戏登录账号</h2><button class="secondary" onclick={refresh} disabled={busy}>{busy ? '处理中…' : '刷新列表'}</button></div>
  <label class="account-search"><span class="sr-only">搜索登录名或存档</span><input bind:value={search} placeholder="搜索登录名、蛙名或存档标识…" disabled={busy} /></label>
  <div class="table-wrap"><table>
    <thead><tr><th>登录名</th><th>关联存档</th><th>状态</th><th>最近登录</th><th>有效凭据</th><th>操作</th></tr></thead>
    <tbody>{#each filteredUsers as user (user.username)}<tr>
      <td><strong>{user.username}</strong><small class="account-created">创建：{date(user.created_at)}</small></td>
      <td>{frogName(user.account)}<code class="account-id">{user.account}</code></td>
      <td><span class="tag" class:connected={!user.disabled}>{user.disabled ? '已禁用' : '已启用'}</span></td>
      <td>{date(user.last_login)}</td><td>{user.session_count || 0}</td>
      <td><div class="account-actions">
        <button class="text-button" disabled={busy} onclick={() => choose(user, 'reset-password')}>重置密码</button>
        <button class="text-button" disabled={busy} onclick={() => choose(user, 'set-disabled')}>{user.disabled ? '启用' : '禁用'}</button>
        <button class="text-button" disabled={busy} onclick={() => choose(user, 'revoke-sessions')}>退出所有设备</button>
        <button class="text-button delete-action" disabled={busy} onclick={() => choose(user, 'delete')}>删除账号</button>
      </div></td>
    </tr>{:else}<tr><td colspan="6" class="empty-small">{!loaded ? '正在加载登录账号…' : users.length ? '没有匹配的登录账号。' : '尚未创建游戏登录账号。'}</td></tr>{/each}</tbody>
  </table></div>
</section>

{#if target}
  <section class="panel account-editor" aria-label="登录账号操作" bind:this={editor}>
    <div class="panel-heading"><h2>{actionNames[target.action]} · {target.user.username}</h2><button class="text-button" onclick={cancel} disabled={busy}>取消</button></div>
    <form onsubmit={apply}>
      <fieldset disabled={busy}>
        {#if target.action === 'reset-password'}
          <p class="muted">原设备的登录凭据会失效，使用者下次需要输入新密码。</p>
          <label>新密码<input type="password" bind:value={resetPassword} minlength="10" maxlength="128" autocomplete="new-password" required /></label>
        {:else if target.action === 'set-disabled'}
          <p>{target.user.disabled ? '启用后，使用者可以使用现有密码重新登录。' : '禁用后，该账号无法登录，已有登录凭据会撤销。游戏存档仍保留。'}</p>
        {:else if target.action === 'revoke-sessions'}
          <p>撤销 <strong>{target.user.username}</strong> 的全部登录凭据。使用者可用现有密码重新登录，游戏存档仍保留。</p>
        {:else if target.action === 'delete'}
          <p>删除登录账号 <strong>{target.user.username}</strong> 并撤销其登录凭据。关联存档 <strong>{frogName(target.user.account)}</strong>（<code>{target.user.account}</code>）将保留，不会删除相册或游戏进度。</p>
          <label>输入登录名 {target.user.username} 确认删除<input bind:value={confirmation} autocomplete="off" required /></label>
          <label class="checkbox"><input type="checkbox" bind:checked={acknowledged} />我确认删除这个登录账号，并保留游戏存档</label>
        {/if}
        <div class="account-editor-actions"><button class:danger={target.action === 'delete' || (target.action === 'set-disabled' && !target.user.disabled)} class:primary={target.action !== 'delete' && (target.action !== 'set-disabled' || target.user.disabled)} disabled={target.action === 'delete' && (confirmation !== target.user.username || !acknowledged)}>{busy ? '正在处理…' : target.action === 'set-disabled' ? (target.user.disabled ? '确认启用' : '确认禁用') : '确认' + actionNames[target.action]}</button><button type="button" class="secondary" disabled={busy} onclick={cancel}>取消</button></div>
      </fieldset>
    </form>
  </section>
{/if}

<style>
  .account-top{margin-bottom:24px}.account-summary dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:28px 0}.account-summary dt{color:var(--muted);font-size:12px}.account-summary dd{margin:4px 0 0;font-size:28px;line-height:1.5;color:var(--green)}.account-summary dd small{font-size:12px}.account-search{max-width:470px}.account-id,.account-created{display:block}.account-id{margin-top:3px}.account-created{font-size:10px;font-weight:400;margin-top:5px}.account-actions{display:flex;flex-wrap:wrap;gap:8px 14px;min-width:170px}.delete-action{color:#974f3c}.account-editor{border-color:#d2bfa8;margin-top:24px;background:#fffdf5}.account-editor-actions{display:flex;gap:12px}.account-editor input[type=password]{max-width:480px}.account-editor p{max-width:850px}.footnote{font-size:12px;color:var(--muted)}@media(max-width:620px){.account-summary dl{gap:6px}.account-summary dd{font-size:24px}.account-editor-actions{flex-wrap:wrap}}
</style>
