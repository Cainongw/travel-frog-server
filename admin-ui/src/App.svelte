<script>
  import { onMount } from 'svelte';
  import { api, setToken, setSession, authSession, downloadJson } from './api.js';
  import Postcard from './Postcard.svelte';
  import Garden from './Garden.svelte';
  import Snapshots from './Snapshots.svelte';
  import GameAccounts from './GameAccounts.svelte';

  let secret = '';
  let auth = {mode:'token',configured:false};
  let gameAccounts;
  let connected = false;
  let busy = false;
  let loadingAccount = false;
  let error = '';
  let notice = '';
  let status = {};
  let catalog = { items: [], templates: [], notes: [], pictures: [], resources: {} };
  let accounts = [];
  let selected = '';
  let snapshot = null;
  let garden = null;
  let activity = { operations: [], backups: [] };
  let snapshotPage = { snapshots: [], next_cursor: null };
  let unsupportedCalls = [];
  let search = '';
  let newAccount = '';
  let tab = 'overview';
  let requestVersion = 0;
  let templateId = 0;
  let companion = -1;
  let custom = false;
  let pictureText = '';
  let parsedPicture = null;
  let pictureError = '';
  let postcardTitle = '寄来一份沿途的风景';
  let postcardMessage = '旅途有新的发现，想与你分享。';
  let mailTitle = '一份小小的旅行补给';
  let mailMessage = '带上这些补给，开启下一段旅行吧。';
  let giftClover = 100;
  let giftTicket = 0;
  let itemSearch = '';
  let itemId = 0;
  let itemCount = 1;
  let giftItems = [];
  let frogName = '';
  let clover = 0;
  let ticket = 0;
  let season = 1;
  let hours = 1;
  let weather = 1;
  let noteId = 1000;
  let importSave = null;
  let importName = '';
  let importConfirm = '';
  let importAcknowledged = false;
  let albumLocation = 'all';
  let previewAlbum = null;

  const tabs = [
    { id: 'overview', label: '蛙居概览', mark: '01' },
    { id: 'postcards', label: '明信片邮局', mark: '02' },
    { id: 'mail', label: '礼物与邮件', mark: '03' },
    { id: 'garden', label: '庭院与制造', mark: '04' },
    { id: 'archive', label: '存档管理', mark: '05' },
    { id: 'activity', label: '操作记录', mark: '06' },
    { id: 'game-accounts', label: '账号管理', mark: '07' },
  ];
  const companions = [{ id: -1, name: '独自旅行' }, { id: 0, name: '壁虎同行' }, { id: 1, name: '刺猬同行' }, { id: 2, name: '萤火虫同行' }];
  const actionNames = { create: '创建账号', postcards: '下发明信片', mail: '寄送奖励邮件', role: '修改角色', weather: '设置天气', notes: '解锁笔记', import: '导入存档', 'visitor-depart': '访客离场', 'furniture-put': '放入工作台', 'furniture-take': '取出工作台物品', 'furniture-buy': '购买家具商品', 'furniture-replace': '摆放家具', 'furniture-advance': '检查制造进度', 'furniture-finish': '立即完成制造', 'neighbor-arrive': '邻居来访', 'neighbor-depart': '邻居离场' };
  const locations = { album: '已保存', new: '待收取', recycle: '回收站', gift: '礼品盒' };
  const date = value => value ? new Date(value * 1000).toLocaleString('zh-CN', { hour12: false }) : '—';
  const number = value => Number(value || 0).toLocaleString('zh-CN');
  $: visibleAccounts = accounts.filter(x => `${x.account} ${x.frog_name}`.toLowerCase().includes(search.toLowerCase()));
  $: currentAccount = accounts.find(x => x.account === selected);
  $: template = catalog.templates.find(x => x.id === Number(templateId));
  $: templatePicture = template?.variants?.find(x => x.companion_id === Number(companion))?.picture || template?.picture || null;
  $: if (custom) {
    try {
      const value = JSON.parse(pictureText);
      if (!Number.isSafeInteger(value.pic_id) || !Array.isArray(value.layers) || !value.layers.length || value.layers.length > 64
        || value.layers.some(x => !Array.isArray(x.layer) || x.layer.length !== 3 || !x.layer.every(Number.isSafeInteger))) throw Error('格式需包含 pic_id 与 1–64 个 {"layer":[资源编号,x,y]} 图层。');
      parsedPicture = value;
      pictureError = '';
    } catch (e) { parsedPicture = null; pictureError = e.message; }
  }
  $: shownPicture = custom ? parsedPicture : templatePicture;
  $: filteredItems = catalog.items.filter(x => `${x.id} ${x.name}`.includes(itemSearch)).slice(0, 150);
  $: album = (snapshot?.postcards || []).filter(x => albumLocation === 'all' || x.location === albumLocation);

  function clearMessages() { error = ''; notice = ''; }
  onMount(async()=>{
    try{auth=await authSession();if(auth.authenticated){setSession(auth.csrf);await login();}}catch(e){error=e.message;}
  });
  async function login(event) {
    event?.preventDefault();
    clearMessages(); busy = true; if(auth.mode!=='oidc')setToken(secret.trim());
    try {
      const [state, data, list] = await Promise.all([api('status'), api('catalog'), api('accounts')]);
      status = state; catalog = data; accounts = list.accounts; connected = true; secret = '';
      templateId = catalog.templates[0]?.id ?? 0;
      noteId = catalog.notes[0]?.id ?? 1000;
      itemId = catalog.items[0]?.id ?? 0;
      if (accounts.length) await loadAccount(accounts[0].account);
    } catch (e) { error = e.message; setToken(''); }
    finally { busy = false; }
  }
  async function logout() {
    if(auth.mode==='oidc'){
      const response=await fetch('/auth/logout',{method:'POST',headers:{'X-CSRF-Token':auth.csrf}});
      if(!response.ok){error='退出失败，请重试。';return;}
      setSession('');window.location.assign('/admin/');return;
    }
    requestVersion++; connected = false; setToken(''); snapshot = null; garden = null; selected = ''; accounts = [];
    catalog = { items: [], templates: [], notes: [], pictures: [], resources: {} };
    importSave = null; importName = ''; importConfirm = ''; importAcknowledged = false; clearMessages();
  }
  async function loadAccount(account, keepVisible = false) {
    const version = ++requestVersion;
    const preserve = keepVisible && account === selected && snapshot;
    selected = account; loadingAccount = !preserve;
    if (!preserve) { snapshot = null; garden = null; previewAlbum = null; }
    importSave = null; importName = ''; importConfirm = ''; importAcknowledged = false;
    try {
      const [save, log, courtyard, saves, missing] = await Promise.all([api('account', account), api('audit', account), api('garden', account), api('snapshots', account), api('unsupported',account)]);
      if (version !== requestVersion) return;
      snapshot = save; activity = log; garden = courtyard;
      snapshotPage = saves;
      unsupportedCalls = missing.calls;
      frogName = save.account.frog_name; clover = save.account.clover; ticket = save.account.ticket;
      season = save.weather.season; hours = save.weather.hours_type; weather = save.weather.weather || 1;
    } catch (e) { if (version === requestVersion) error = e.message; }
    finally { if (version === requestVersion) loadingAccount = false; }
  }
  async function refresh() {
    busy = true; clearMessages();
    try {
      const [state, list] = await Promise.all([api('status'), api('accounts')]);
      status = state; accounts = list.accounts;
      if (selected) await loadAccount(selected);
      if (tab === 'game-accounts') await gameAccounts?.refresh();
      notice = '已获取服务器最新状态。';
    } catch (e) { error = e.message; } finally { busy = false; }
  }
  async function mutate(action, body, message, account = selected) {
    if(snapshot?.official && snapshot.official.mode!=='active' && !['import','create','snapshot-create','snapshot-restore','archive-activate'].includes(action)) { error='先创建快照即可解除只读并开始测试。'; return null; }
    busy = true; clearMessages();
    try {
      const result = await api(action, account, { body });
      notice = `${message}${result.activated ? ' 已解除只读，请重新进入游戏开始测试。' : ''}${result.replayed ? '（此操作已处理，未重复执行）' : ''}`;
      const list = await api('accounts'); accounts = list.accounts;
      await loadAccount(account, true);
      return result;
    } catch (e) { error = e.message; return null; }
    finally { busy = false; }
  }
  async function createAccount(event) {
    event.preventDefault();
    const account = newAccount.trim();
    if (!account) return;
    const result = await mutate('create', {}, '账号已创建。', account);
    if (result) newAccount = '';
  }
  function editLayers() {
    pictureText = JSON.stringify({ pic_id: templatePicture?.pic_id, layers: templatePicture?.layers }, null, 2);
    custom = true;
  }
  function sendPostcard(event) {
    event.preventDefault();
    const content = custom ? { picture: parsedPicture } : { template_id: Number(templateId), companion_id: Number(companion) };
    mutate('postcards', { ...content, title: postcardTitle, message: postcardMessage }, '明信片已存入待收取相册，并寄出通知邮件。在线客户端已推送；离线客户端下次登录同步。');
  }
  function addItem() {
    const id = Number(itemId), count = Number(itemCount);
    if (!Number.isInteger(count) || count < 1 || count > 99) { error = '物品数量需为 1–99。'; return; }
    const found = giftItems.find(x => x.item_id === id);
    if (found) giftItems = giftItems.map(x => x === found ? { ...x, count } : x);
    else giftItems = [...giftItems, { item_id: id, count }];
  }
  function sendMail(event) {
    event.preventDefault();
    mutate('mail', { title: mailTitle, message: mailMessage, clover: Number(giftClover), ticket: Number(giftTicket), items: giftItems }, '邮件已寄出，奖励会在客户端领取后入账。');
  }
  async function exportSave(backupId) {
    busy = true; clearMessages();
    try {
      const save = await api(backupId ? 'backup' : 'export', selected, backupId ? { query: { id: backupId } } : {});
      downloadJson(save, `${selected}${backupId ? '-backup-' + backupId : '-save'}.json`);
      notice = 'JSON 存档已下载。';
    } catch (e) { error = e.message; } finally { busy = false; }
  }
  async function chooseImport(event) {
    clearMessages(); importSave = null; importConfirm = ''; importAcknowledged = false;
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw Error('存档不能大于 10 MiB。');
      const data = JSON.parse(await file.text());
      if (data.format !== 'travel-frog-save' || ![1, 2, 3, 4, 5, 6].includes(data.version)) throw Error('请选择支持的 travel-frog-save JSON 存档。');
      if (data.account?.account !== selected) throw Error('存档账号与当前所选账号不同，请先选择对应账号。');
      importSave = data; importName = file.name;
    } catch (e) { error = e.message; }
    event.target.value = '';
  }
  function importArchive(event) {
    event.preventDefault();
    if (importConfirm !== selected || !importAcknowledged || !importSave) return;
    mutate('import', { save: importSave }, '存档已导入。替换前的存档已自动备份，可在操作记录中下载。客户端需重新进入游戏。');
  }
  Object.assign(actionNames,{'snapshot-create':'创建存档快照','snapshot-restore':'从快照回档'});
  Object.assign(actionNames,{'archive-activate':'启用存档测试玩法'});
</script>

<svelte:head><title>{connected ? (snapshot?.account.frog_name || '账号管理') + ' · ' : ''}青蛙邮局</title></svelte:head>

{#if !connected}
  <main class="login-page">
    <div class="login-story">
      <div class="brand"><span class="brand-symbol">蛙</span><span>青蛙邮局<small>TRAVEL FROG · LOCAL ARCHIVE</small></span></div>
      <p class="eyebrow">给每一段旅途，留一个家</p>
      <h1>远方的风景，<br />在这里寄出。</h1>
      <p class="login-intro">管理小青蛙的生活、收藏与旅程。<br />让每一张明信片，都有归处。</p>
      <div class="envelope" aria-hidden="true"><div class="stamp">旅行<br />POST</div><span>致：旅途中的你</span><i></i><i></i><i></i><div class="postmark">FROG POST<br />旅途长存</div></div>
      <div class="login-foot">本地存档 · 原生游戏协议 · 自己的邮局</div>
    </div>
    <section class="login-card">
      <span class="eyebrow">POSTMASTER ACCESS</span><h2>进入管理台</h2>
      <p class="muted">连接当前服务器，开始管理你的青蛙档案。</p>
      {#if auth.mode==='oidc'}
        <p class="muted">使用统一身份登录管理青蛙档案。</p>
        {#if !auth.configured}<p class="notice">尚未配置 Authentik 客户端，请按部署说明设置。</p>{/if}
        {#if error}<p class="notice error" role="alert">{error}</p>{/if}
        <a class="primary wide" href="/auth/login">通过 Authentik 登录 →</a>
      {:else}<form onsubmit={login}>
        <label>管理密钥<input type="password" bind:value={secret} autocomplete="off" placeholder="输入 FROG_ADMIN_TOKEN" minlength="24" required disabled={busy} /></label>
        <small>密钥仅保留在本次页面内存中，刷新页面后需重新输入。</small>
        {#if error}<p class="notice error" role="alert">{error}</p>{/if}
        <button class="primary wide" disabled={busy}>{busy ? '正在连接…' : '连接邮局'}<span>→</span></button>
      </form>{/if}
      <div class="server-address"><span class="dot"></span>同源连接 <code>{typeof window !== 'undefined' ? window.location.host : ''}</code></div>
    </section>
  </main>
{:else}
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-symbol">蛙</span><span>青蛙邮局<small>管理台 / POSTMASTER</small></span></div>
      <div class="sidebar-section"><span>管理导航</span><small>WORKSPACE</small></div>
      <nav aria-label="管理导航">{#each tabs as entry}<button class:active={tab === entry.id} disabled={busy || loadingAccount} onclick={() => tab = entry.id}><span>{entry.mark}</span>{entry.label}{#if tab === entry.id}<b>●</b>{/if}</button>{/each}</nav>
      <div class="sidebar-section"><span>青蛙档案</span><small>{accounts.length} 个账号</small></div>
      <label class="search-label"><span class="sr-only">搜索账号</span><input class="search" placeholder="搜索蛙名或账号…" bind:value={search} /></label>
      <div class="account-list">{#each visibleAccounts as account}<button class:selected={selected === account.account} disabled={busy || loadingAccount} onclick={() => { clearMessages(); loadAccount(account.account); }}><span class="avatar">{(account.frog_name || '蛙').slice(0, 1)}</span><span><strong>{account.frog_name}</strong><small>{account.account}</small></span><span class:online={account.online} class="presence" title={account.online ? '在线' : '离线'}></span></button>{:else}<p class="muted empty-small">{accounts.length ? '没有匹配的账号' : '邮局还没有账号'}</p>{/each}</div>
      <details class="create-account"><summary>＋ 新建本地账号</summary><form onsubmit={createAccount}><label><span class="sr-only">新账号标识</span><input bind:value={newAccount} maxlength="128" placeholder="例如 frog-home" required disabled={busy} /></label><button class="secondary wide" disabled={busy}>创建账号</button></form></details>
      <div class="sidebar-bottom"><span class="dot online"></span><span>服务器已连接<small>v{status.version} · SQLite {status.schema}</small></span><button class="text-button" onclick={logout} disabled={busy}>断开</button></div>
    </aside>
    <main class="workspace">
      {#if snapshot?.official}<div class="notice" role="status">{#if snapshot.official.mode==='active'}测试模式：已解除只读，使用私服正常玩法逻辑；可随时从快照回档。原始官方记录仍保留。{:else}请先在“存档管理”创建快照，完成后自动解除只读。{#if snapshotPage.snapshots.length}<button class="secondary" disabled={busy} onclick={()=>mutate('archive-activate',{},'测试玩法已启用。')}>已有快照，启用玩法</button>{/if}{/if}</div>{/if}
      <header class="topbar"><div><span class="breadcrumb">青蛙邮局 / {tabs.find(x => x.id === tab)?.label}</span><h1>{tabs.find(x => x.id === tab)?.label}</h1></div><div class="top-actions"><span class="online-label">{status.online || 0} 个客户端在线</span><button class="secondary" onclick={refresh} disabled={busy || loadingAccount}>{busy ? '处理中…' : '↻ 刷新状态'}</button></div></header>
      {#if error}<div class="notice error" role="alert">{error}<button class="text-button" onclick={() => error = ''}>关闭</button></div>{/if}
      {#if notice}<div class="notice success" role="status">{notice}<button class="text-button" onclick={() => notice = ''}>关闭</button></div>{/if}
      {#if !catalog.available}<div class="notice warning">APK 资源目录尚未配置，明信片、物品与笔记目录暂不可用。请在服务器设置 FROG_ASSETS。</div>{/if}
      {#if tab === 'game-accounts'}<GameAccounts bind:this={gameAccounts} bind:busy {selected} />
      {:else if loadingAccount}<section class="empty-state"><div class="spinner"></div><h2>正在打开蛙的档案…</h2></section>
      {:else if !snapshot}<section class="empty-state"><span class="empty-illustration">✉</span><h2>先选一位旅人</h2><p>从左侧选择账号，或创建一个新的本地账号。</p></section>
      {:else}
        <div class="recipient-bar"><span class="avatar">{snapshot.account.frog_name.slice(0, 1)}</span><div><strong>{snapshot.account.frog_name}</strong><code>{selected}</code></div><span class:connected={currentAccount?.online} class="tag">{currentAccount?.online ? '客户端在线' : '客户端离线'}</span><span class="recipient-note">当前所有操作将应用于此账号</span></div>
        {#if tab === 'overview'}
          <section class="hero-card"><div><p class="eyebrow">A LITTLE LIFE, A LONG JOURNEY</p><h2>{snapshot.account.frog_status === 1 ? '蛙在远方，风景在路上。' : '欢迎回家，下一站再出发。'}</h2><p>{snapshot.travel.current ? '预计归来：' + date(snapshot.travel.current.returns_at) : '整理背包、收好明信片，等待下一段小小的旅行。'}</p></div><div class="journey-seal"><strong>{number(snapshot.account.trip_count)}</strong><span>段旅行</span></div></section>
          <div class="stats-grid"><div class="stat"><span>三叶草</span><strong>{number(snapshot.account.clover)}<small>棵</small></strong></div><div class="stat"><span>抽奖券</span><strong>{number(snapshot.account.ticket)}<small>张</small></strong></div><div class="stat"><span>明信片收藏</span><strong>{snapshot.postcards.length}<small>张</small></strong></div><div class="stat"><span>旅行笔记</span><strong>{snapshot.travel_notes.length}<small>篇</small></strong></div></div>
          <div class="two-columns">
            <section class="panel"><div class="panel-heading"><h2>蛙的资料</h2><span>PROFILE</span></div><form onsubmit={event => { event.preventDefault(); mutate('role', { frog_name: frogName, clover: Number(clover), ticket: Number(ticket) }, '角色资料已更新。'); }}><label>蛙名<input bind:value={frogName} maxlength="5" required /></label><div class="field-row"><label>三叶草余额<input type="number" bind:value={clover} min="0" max="999999" required /></label><label>抽奖券余额<input type="number" bind:value={ticket} min="0" max="999" required /></label></div><small>保存将直接设置余额。若想发送可领取的奖励，请使用“礼物与邮件”。</small><button class="primary" disabled={busy}>保存资料</button></form></section>
            <section class="panel"><div class="panel-heading"><h2>庭院的天气</h2><span>GARDEN</span></div><form onsubmit={event => { event.preventDefault(); mutate('weather', { season: Number(season), hours_type: Number(hours), weather: Number(weather) }, '天气已保存，重新进入游戏后生效。'); }}><div class="field-row"><label>季节<select bind:value={season}>{#each ['春', '夏', '秋', '冬'] as name, i}<option value={i + 1}>{name}</option>{/each}</select></label><label>时段<select bind:value={hours}>{#each ['白天', '傍晚', '夜晚', '深夜'] as name, i}<option value={i + 1}>{name}</option>{/each}</select></label></div><label>天气<select bind:value={weather}>{#each ['晴', '阴', '小雨', '大雨', '雾', '霜', '风', '小雪', '大雪'] as name, i}<option value={i + 1}>{name}</option>{/each}</select></label><small>游戏需重新进入，才能加载对应的季节与场景资源。</small><button class="primary" disabled={busy}>保存天气</button></form></section>
            <section class="panel"><div class="panel-heading"><h2>旅行笔记</h2><span>JOURNAL</span></div><p class="muted">从客户端原生笔记中解锁一篇，保留它的图文内容。</p><form onsubmit={event => { event.preventDefault(); mutate('notes', { id: Number(noteId) }, '笔记已解锁。'); }}><label>笔记编号<select bind:value={noteId} disabled={!catalog.notes.length}>{#each catalog.notes as note}<option value={note.id}>#{note.id} · 类型 {note.type}{snapshot.travel_notes.some(x => x.id === note.id) ? ' · 已解锁' : ''}</option>{/each}</select></label><button class="secondary" disabled={busy || !catalog.notes.length}>解锁笔记</button></form></section>
            <section class="panel"><div class="panel-heading"><h2>庭院来客</h2><span>VISITOR</span></div>{#if snapshot.visitor?.current}<h3>{snapshot.visitor.current.name} · {snapshot.visitor.current.city.split('_')[0]}</h3><p class="muted">离场时间：{date(snapshot.visitor.current.expire_time)}</p><p class="muted">让访客提前离场后，可在客户端领取留下的礼物。</p><button class="secondary" onclick={() => mutate('visitor-depart', {}, '访客已离场，客户端可领取礼物。')} disabled={busy}>让访客离场</button>{:else}<p class="muted">当前没有访客。客户端同步时会按来访计时生成。</p>{/if}<div class="province-list">{#each snapshot.visitor?.acquire || [] as province}<span class="tag">{province}</span>{/each}</div></section>
          </div>
        {:else if tab === 'garden'}
          <Garden {catalog} {snapshot} {garden} {busy} onAction={mutate} />
        {:else if tab === 'postcards'}
          <div class="section-intro"><div><p class="eyebrow">SEND A LITTLE WONDER</p><h2>把远方，寄到蛙的邮箱。</h2></div><p>明信片将进入待收取相册。<br />在线推送，离线留存。</p></div>
          <div class="postcard-layout"><section class="postcard-preview"><div class="paper-frame"><Postcard picture={shownPicture} /><div class="postcard-caption"><span>{custom ? '自定义明信片' : template?.name || '未选择'}</span><small>TRAVEL FROG / {shownPicture?.pic_id || '—'}</small></div></div><div class="preview-meta"><span>500 × 350 · 原生图层合成</span><span>{shownPicture?.layers?.length || 0} 个图层</span></div>{#if !custom && companion !== -1 && !template?.variants}<p class="notice warning">服务器暂未提供同行者预览，当前仅显示独行版；实际下发会包含所选同行者。</p>{/if}</section>
            <section class="panel compose-panel"><div class="panel-heading"><h2>写一张明信片</h2><span>COMPOSE</span></div><form onsubmit={sendPostcard}>
              <fieldset disabled={busy || !catalog.available}><label>旅途场景<select bind:value={templateId} onchange={() => custom = false}>{#each catalog.templates as entry}<option value={entry.id}>{entry.name}</option>{/each}</select></label><label>同行伙伴<select bind:value={companion} disabled={custom}>{#each companions as entry}<option value={entry.id}>{entry.name}</option>{/each}</select></label><label>邮件标题<input bind:value={postcardTitle} maxlength="100" required /></label><label>给蛙的留言<textarea bind:value={postcardMessage} rows="3" maxlength="2000"></textarea></label><div class="delivery-address"><small>寄往</small><strong>{snapshot.account.frog_name}</strong><code>{selected}</code></div><button class="primary wide" disabled={!shownPicture || !!(custom && pictureError)}>寄出明信片 <span>↗</span></button></fieldset>
            </form></section></div>
          <section class="panel layer-panel"><div class="panel-heading"><h2>图层编辑</h2><button class="text-button" onclick={() => custom ? custom = false : editLayers()} disabled={busy || !catalog.available}>{custom ? '恢复模板' : '从当前模板编辑 →'}</button></div><p class="muted">使用 APK 内已有的图片资源，可以组合新的明信片。外部图片上传暂不支持。</p>{#if custom}<label>明信片 JSON<textarea class="code-editor" bind:value={pictureText} rows="12" spellcheck="false"></textarea></label>{#if pictureError}<p class="notice error">{pictureError}</p>{/if}{/if}<details><summary>查看资源编号与图片编号</summary><div class="catalog-reference"><div><h3>图片编号 pic_id</h3>{#each catalog.pictures as p}<p><code>{p.id}</code> {p.name}</p>{/each}</div><div><h3>图层资源编号</h3>{#each Object.entries(catalog.resources) as [id, name]}<p><code>{id}</code> {name}</p>{/each}</div></div></details></section>
        {:else if tab === 'mail'}
          <div class="section-intro"><div><p class="eyebrow">A GIFT FOR THE NEXT JOURNEY</p><h2>准备一份旅行补给。</h2></div><p>奖励先寄往邮箱，<br />领取后再计入库存。</p></div>
          <div class="two-columns mail-layout"><section class="panel"><div class="panel-heading"><h2>寄送奖励邮件</h2><span>PARCEL</span></div><form onsubmit={sendMail}><fieldset disabled={busy}><label>邮件标题<input bind:value={mailTitle} maxlength="100" required /></label><label>正文<textarea bind:value={mailMessage} rows="4" maxlength="2000"></textarea></label><div class="field-row"><label>三叶草<input type="number" bind:value={giftClover} min="0" max="999999" required /></label><label>抽奖券<input type="number" bind:value={giftTicket} min="0" max="999" required /></label></div><div class="attachment-box"><h3>添加物品</h3><label><span class="sr-only">搜索物品</span><input bind:value={itemSearch} placeholder="按名称或编号搜索…" /></label><div class="item-picker"><label><span class="sr-only">物品</span><select bind:value={itemId} disabled={!catalog.available}>{#each filteredItems as item}<option value={item.id}>#{item.id} {item.name}</option>{/each}</select></label><label><span class="sr-only">数量</span><input type="number" min="1" max="99" bind:value={itemCount} /></label><button type="button" class="secondary" onclick={addItem} disabled={!filteredItems.some(x => x.id === Number(itemId))}>添加</button></div>{#each giftItems as item}<div class="attachment"><span>{catalog.items.find(x => x.id === item.item_id)?.name || item.item_id} <small>× {item.count}</small></span><button type="button" class="text-button" onclick={() => giftItems = giftItems.filter(x => x !== item)}>移除</button></div>{/each}</div><div class="delivery-address"><small>寄往</small><strong>{snapshot.account.frog_name}</strong><code>{selected}</code></div><button class="primary wide">寄出奖励邮件 <span>↗</span></button></fieldset></form></section>
            <section class="panel"><div class="panel-heading"><h2>邮箱记录</h2><span>{snapshot.mails.length} 封</span></div><div class="mail-list">{#each snapshot.mails as mail}<article><div><span class="mail-icon">✉</span><h3>{mail.title}</h3><span class="tag">{mail.opened ? '已领取' : mail.read ? '已读' : '未读'}</span></div><p>{mail.message}</p><small>{date(mail.timestamp)} · 草 {mail.resource?.clover_point || 0} / 券 {mail.resource?.ticket || 0}{mail.pictures?.length ? ' / 明信片 ' + mail.pictures.length : ''}</small></article>{:else}<div class="empty-small">还没有邮件。</div>{/each}</div></section></div>
        {:else if tab === 'archive'}
          <Snapshots account={selected} page={snapshotPage} {busy} onAction={mutate} />
          <div class="two-columns"><section class="panel"><div class="panel-heading"><h2>保存一份回忆</h2><span>EXPORT</span></div><p class="muted">导出当前账号的完整私服存档，包括相册、背包、旅行、笔记和邮件。JSON 可用于迁移或恢复。</p><button class="primary" onclick={() => exportSave()} disabled={busy}>↓ 下载存档 JSON</button><p class="footnote">这是当前私服的存档，不会从官方账号自动读取历史进度。</p></section><section class="panel"><div class="panel-heading"><h2>导入存档</h2><span>RESTORE</span></div><p class="muted">导入会替换当前账号数据。服务器会先保存自动备份，可在操作记录中下载。</p><label class="file-picker">选择 JSON 文件<input type="file" accept=".json,application/json" onchange={chooseImport} disabled={busy} /></label>{#if importSave}<form onsubmit={importArchive}><div class="import-summary"><strong>{importName}</strong><small>v{importSave.version} · {importSave.postcards?.length || 0} 张明信片 · {importSave.account.frog_name}</small></div><label>输入账号 {selected} 确认替换<input bind:value={importConfirm} autocomplete="off" required /></label><label class="checkbox"><input type="checkbox" bind:checked={importAcknowledged} />我确认用此文件替换所选账号的存档</label><button class="danger" disabled={busy || importConfirm !== selected || !importAcknowledged}>确认替换存档</button></form>{/if}</section></div>
          <section class="panel"><div class="panel-heading"><h2>明信片档案</h2><label><span class="sr-only">相册范围</span><select bind:value={albumLocation}><option value="all">全部位置</option>{#each Object.entries(locations) as [key, value]}<option value={key}>{value}</option>{/each}</select></label></div>{#if previewAlbum}<div class="album-preview"><Postcard picture={previewAlbum} compact /><button class="text-button" onclick={() => previewAlbum = null}>收起预览</button></div>{/if}<div class="table-wrap"><table><thead><tr><th>记录编号</th><th>图片编号</th><th>所在位置</th><th>图层</th><th>操作</th></tr></thead><tbody>{#each album as picture}<tr><td>#{picture.id}</td><td>{picture.pic_id}</td><td><span class="tag">{locations[picture.location] || picture.location}</span></td><td>{picture.layers.length}</td><td><button class="text-button" onclick={() => previewAlbum = picture}>预览</button></td></tr>{:else}<tr><td colspan="5" class="empty-small">这里暂时没有明信片。</td></tr>{/each}</tbody></table></div></section>
          <section class="panel"><div class="panel-heading"><h2>背包与库存</h2><span>INVENTORY</span></div><p class="muted">背包：{snapshot.items.bag.map(id => id < 0 ? '空' : catalog.items.find(x => x.id === id)?.name || '#' + id).join(' / ')}</p><div class="inventory-grid">{#each snapshot.items.house as item}<div><span>{catalog.items.find(x => x.id === item.item_id)?.name || '#' + item.item_id}</span><strong>× {item.count}</strong></div>{:else}<p class="muted">库存为空。</p>{/each}</div></section>
        {:else if tab === 'activity'}
          <section class="panel"><div class="panel-heading"><h2>未实现功能日志</h2><span>{unsupportedCalls.length} 类</span></div><p class="muted">点击未支持功能后在此聚合记录；“仅快照读取”表示目前能展示原数据，尚无玩法实现。参数只保留结构和数字，文本与凭据已脱敏。</p><div class="table-wrap"><table><thead><tr><th>协议</th><th>状态</th><th>次数</th><th>最近触发</th><th>参数摘要</th></tr></thead><tbody>{#each unsupportedCalls as call}<tr><td><code>{call.command}</code></td><td>{call.reason==='snapshot_read_only'?'仅快照读取':call.reason==='archive_readonly'?'尚未解除只读':'未实现'}</td><td>{call.count}</td><td>{date(call.last_at)}</td><td><code>{JSON.stringify(call.sample)}</code></td></tr>{:else}<tr><td colspan="5" class="empty-small">还没有触发未支持功能。</td></tr>{/each}</tbody></table></div></section>
          <div class="section-intro"><div><p class="eyebrow">EVERY LETTER HAS A TRACE</p><h2>每一次修改，都有记录。</h2></div><p>当前账号最近 100 条管理操作。</p></div><section class="panel"><div class="table-wrap"><table><thead><tr><th>时间</th><th>操作</th><th>账号</th><th>请求编号</th></tr></thead><tbody>{#each activity.operations as operation}<tr><td>{date(operation.created_at)}</td><td>{actionNames[operation.action] || operation.action}</td><td>{operation.account}</td><td><code class="request-id">{operation.request_id}</code></td></tr>{:else}<tr><td colspan="4" class="empty-small">尚无管理操作记录。</td></tr>{/each}</tbody></table></div></section><section class="panel"><div class="panel-heading"><h2>替换前的自动备份</h2><span>RECOVERY</span></div><p class="muted">每次导入前自动保留当前存档。下载后可在存档管理中重新导入。</p>{#each activity.backups as backup}<div class="backup-row"><span>备份 #{backup.id}<small>{date(backup.created_at)}</small></span><button class="secondary" onclick={() => exportSave(backup.id)} disabled={busy}>下载 JSON</button></div>{:else}<p class="empty-small">尚未执行存档替换，无自动备份。</p>{/each}</section>
        {/if}
      {/if}
      <footer class="workspace-footer"><span>青蛙邮局 · 让旅途长存</span><span>LOCAL ARCHIVE / {new Date().getFullYear()}</span></footer>
    </main>
  </div>
{/if}
