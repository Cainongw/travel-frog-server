<script>
  import { onMount } from 'svelte';
  import { api } from './api.js';
  import { announcementStatus, publishAnnouncement } from './announcements.js';
  export let busy = false;
  let entries = [], loaded = false;
  let title = '', body = '', expires = '';
  let error = '', notice = '', disableTarget = null;
  let now = Math.floor(Date.now() / 1000);
  $: announcements = entries.map(entry => ({ ...entry, status: announcementStatus(entry, now) }));
  $: activeCount = announcements.filter(entry => entry.status === 'active').length;
  const date = value => value ? new Date(value * 1000).toLocaleString('zh-CN', { hour12: false }) : '长期有效';
  async function read() {
    const data = await api('announcements');
    entries = data.announcements;
    now = Math.floor(Date.now() / 1000);
    loaded = true;
  }
  export async function refresh() {
    busy = true; error = '';
    try { await read(); } catch (e) { error = e.message; }
    finally { busy = false; }
  }
  onMount(() => {
    refresh();
    const timer = setInterval(() => { now = Math.floor(Date.now() / 1000); }, 30000);
    return () => clearInterval(timer);
  });
  async function mutate(request, message, clear) {
    if (busy) return;
    busy = true; error = ''; notice = '';
    let committed = false;
    try {
      await api('announcements', null, { body: request });
      committed = true; clear(); notice = message;
      await read();
    } catch (e) { error = committed ? `操作已保存，但刷新列表失败：${e.message}` : e.message; }
    finally { busy = false; }
  }
  async function publish(event) {
    event.preventDefault();
    let request;
    try { request = publishAnnouncement({ title, body, expires }); }
    catch (e) { error = e.message; return; }
    await mutate(request, '公告已发布，客户端将按服务器规则显示。', () => { title = ''; body = ''; expires = ''; });
  }
  async function disable(event) {
    event.preventDefault();
    if (!disableTarget) return;
    await mutate({ action: 'disable', id: disableTarget.id }, '公告已停用。', () => { disableTarget = null; });
  }
</script>

<div class="section-intro">
  <div><p class="eyebrow">A NOTE FOR EVERY TRAVELER</p><h2>向小青蛙们传达新消息。</h2></div>
  <p>全服公告<br />当前有效 {activeCount} 条</p>
</div>
{#if error}<div class="notice error" role="alert">{error}</div>{/if}
{#if notice}<div class="notice success" role="status">{notice}</div>{/if}

<div class="two-columns announcement-compose">
  <section class="panel">
    <div class="panel-heading"><h2>发布游戏公告</h2><span>NEW NOTICE</span></div>
    <p class="muted">公告面向全服玩家，不需要选择账号。游戏中通过通知弹窗显示。</p>
    <form onsubmit={publish}>
      <fieldset disabled={busy || !loaded}>
        <label>公告标题<input bind:value={title} maxlength="100" placeholder="例如：旅行服务更新" required /></label>
        <label>公告正文<textarea bind:value={body} maxlength="2000" rows="7" placeholder="向旅人说明这次有什么新变化…" required></textarea></label>
        <label>到期时间（可选）<input type="datetime-local" bind:value={expires} /></label>
        <small>使用浏览器本地时间；留空长期有效，也可发布后手动停用。</small>
        <button class="primary" type="submit">{busy ? '正在处理…' : '发布公告'}</button>
      </fieldset>
    </form>
  </section>
  <section class="panel announcement-preview">
    <div class="panel-heading"><h2>公告内容预览</h2><span>PREVIEW</span></div>
    <article class="announcement-message"><h3>{title.trim() || '公告标题'}</h3><p>{body.trim() || '填写正文后，在这里检查要向玩家传达的消息。'}</p></article>
    <p class="footnote">以纯文本显示，保留换行。停用后停止后续展示，已看到的消息不会被撤回。</p>
  </section>
</div>

<section class="panel">
  <div class="panel-heading"><h2>公告记录</h2><button class="secondary" onclick={refresh} disabled={busy}>{busy ? '处理中…' : '刷新公告'}</button></div>
  <div class="announcement-list">
    {#each announcements as entry (entry.id)}
      <article class="announcement-entry">
        <div class="announcement-heading"><h3>{entry.title}</h3><span class="tag" class:connected={entry.status === 'active'}>{entry.status === 'active' ? '展示中' : entry.status === 'expired' ? '已到期' : '已停用'}</span></div>
        <p class="announcement-body">{entry.body}</p>
        <div class="announcement-meta"><small>#{entry.id} · 发布于 {date(entry.created_at)} · 到期：{date(entry.expires_at)}</small><small>发布者：{entry.author || '管理员'}</small></div>
        {#if entry.status === 'active'}<button class="text-button" disabled={busy} onclick={() => { disableTarget = entry; error = ''; notice = ''; }}>停用此公告</button>{/if}
        {#if disableTarget?.id === entry.id}
          <form class="announcement-confirm" onsubmit={disable}>
            <p>确认停用“{entry.title}”？之后进入游戏的玩家将不再看到这条公告。</p>
            <div class="announcement-actions"><button type="submit" class="danger" disabled={busy}>确认停用</button><button type="button" class="secondary" disabled={busy} onclick={() => { disableTarget = null; }}>取消</button></div>
          </form>
        {/if}
      </article>
    {:else}<div class="empty-small">{loaded ? '还没有发布过公告。' : '正在读取公告…'}</div>{/each}
  </div>
</section>

<style>
  .announcement-compose{align-items:start;margin-bottom:24px}.announcement-preview{height:100%}.announcement-message{padding:22px;border:1px solid var(--line);border-radius:8px;background:var(--surface-soft);min-height:190px}.announcement-message h3{font-size:17px;color:var(--green);margin-bottom:16px}.announcement-message p,.announcement-body{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;line-height:1.9}.announcement-list{display:grid;gap:0}.announcement-entry{border-top:1px solid var(--line);padding:22px 0}.announcement-entry:first-child{border-top:0;padding-top:0}.announcement-entry:last-child{padding-bottom:0}.announcement-heading{display:flex;align-items:start;justify-content:space-between;gap:16px;margin-bottom:12px}.announcement-heading h3{margin:0;font-size:16px;overflow-wrap:anywhere}.announcement-body{font-size:13px;color:var(--text-secondary)}.announcement-meta{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:15px}.announcement-meta small{font-size:11px;overflow-wrap:anywhere}.announcement-entry>.text-button{margin-top:12px}.announcement-confirm{padding:16px;margin-top:18px;border:1px solid var(--line);border-radius:7px;background:var(--surface-soft)}.announcement-confirm p{margin-bottom:14px;font-size:13px}.announcement-actions{display:flex;gap:12px}@media(max-width:620px){.announcement-meta{display:block}.announcement-meta small{display:block;margin-top:5px}.announcement-message{padding:17px}.announcement-heading h3{font-size:14px}}
</style>
