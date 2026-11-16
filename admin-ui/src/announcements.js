export function announcementStatus(row, now = Math.floor(Date.now() / 1000)) {
  if (!row.active) return 'disabled';
  if (row.expires_at > 0 && row.expires_at <= now) return 'expired';
  return 'active';
}

export function publishAnnouncement({ title, body, expires }, now = Math.floor(Date.now() / 1000)) {
  const cleanTitle = String(title || '').trim(), cleanBody = String(body || '').trim();
  if (!cleanTitle || cleanTitle.length > 100) throw Error('请填写 1–100 字的公告标题。');
  if (!cleanBody || cleanBody.length > 2000) throw Error('请填写 1–2000 字的公告正文。');
  const request = { action: 'publish', title: cleanTitle, body: cleanBody };
  if (expires) {
    const timestamp = Math.floor(new Date(expires).getTime() / 1000);
    if (!Number.isFinite(timestamp) || timestamp <= now) throw Error('到期时间必须晚于现在，或留空。');
    request.expires_at = timestamp;
  }
  return request;
}
