import assert from 'node:assert/strict';
import { test } from 'node:test';
import { announcementStatus, publishAnnouncement } from '../src/announcements.js';

test('announcement publish trims plain text, preserves newlines and converts local expiration to Unix seconds', () => {
  assert.deepEqual(publishAnnouncement({ title: ' 更新 ', body: ' 第一行\n第二行 ', expires: '' }), { action: 'publish', title: '更新', body: '第一行\n第二行' });
  const expires = '2030-01-02T12:30';
  assert.equal(publishAnnouncement({ title: '更新', body: '<b>保持纯文本</b>', expires }, 1).expires_at, Math.floor(new Date(expires).getTime() / 1000));
});

test('invalid and past announcements are rejected before sending while valid drafts remain unchanged', () => {
  for (const draft of [{ title: '', body: '内容' }, { title: 'a'.repeat(101), body: '内容' }, { title: '标题', body: '' }, { title: '标题', body: 'a'.repeat(2001) }, { title: '标题', body: '内容', expires: 'not-a-date' }, { title: '标题', body: '内容', expires: '2000-01-01T01:00' }]) assert.throws(() => publishAnnouncement(draft));
  const draft = { title: ' 标题 ', body: ' 内容 ', expires: '' }, before = structuredClone(draft); publishAnnouncement(draft); assert.deepEqual(draft, before);
});

test('announcement list distinguishes inactive, elapsed and currently displayed notices', () => {
  assert.equal(announcementStatus({ active: false, expires_at: 200 }, 100), 'disabled');
  assert.equal(announcementStatus({ active: true, expires_at: 100 }, 100), 'expired');
  assert.equal(announcementStatus({ active: true, expires_at: 101 }, 100), 'active');
  assert.equal(announcementStatus({ active: true, expires_at: 0 }, 100), 'active');
});
