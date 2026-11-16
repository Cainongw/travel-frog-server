import assert from 'node:assert/strict';
import { test } from 'node:test';
import { THEME_KEY, initializeTheme, createThemeController, resolveTheme } from '../src/theme.js';

function fixture(preference, dark = false) {
  const values = new Map(preference ? [[THEME_KEY, preference]] : []), writes = [], listeners = new Map(), system = new Map();
  const media = { matches: dark, addEventListener: (key, fn) => system.set(key, fn), removeEventListener: key => system.delete(key) };
  const document = { documentElement: { dataset: {}, style: {} } };
  const window = { localStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => { writes.push({ key, value }); values.set(key, value); } }, matchMedia: () => media, addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) };
  return { window, document, media, writes, listeners, system };
}

test('theme applies remembered preference before mount and stores only the theme key', () => {
  const f = fixture('dark');
  assert.deepEqual(initializeTheme(f.window, f.document), { preference: 'dark', resolved: 'dark' });
  assert.equal(f.document.documentElement.dataset.theme, 'dark');
  const controller = createThemeController(f); controller.set('light'); controller.set('system');
  assert.deepEqual(f.writes.map(row => row.key), [THEME_KEY, THEME_KEY]);
  assert.equal(f.document.documentElement.style.colorScheme, 'light'); controller.dispose();
});

test('system changes update automatic mode and do not override an explicit choice', () => {
  const f = fixture(null, false), changes = [], controller = createThemeController({ ...f, onChange: value => changes.push(value) });
  f.media.matches = true; f.system.get('change')(); assert.equal(f.document.documentElement.dataset.theme, 'dark');
  controller.set('light'); f.system.get('change')(); assert.equal(f.document.documentElement.dataset.theme, 'light');
  controller.set('system'); assert.equal(changes.at(-1).resolved, 'dark');
  controller.dispose(); assert.equal(f.system.size, 0); assert.equal(f.listeners.size, 0);
});

test('cross-tab theme updates are limited to the theme preference', () => {
  const f = fixture('light'), controller = createThemeController(f);
  f.listeners.get('storage')({ key: 'token', newValue: 'dark' }); assert.equal(f.document.documentElement.dataset.theme, 'light');
  f.listeners.get('storage')({ key: THEME_KEY, newValue: 'dark' }); assert.equal(f.document.documentElement.dataset.theme, 'dark');
  f.media.matches = false; f.listeners.get('storage')({ key: THEME_KEY, newValue: 'untrusted-value' }); assert.equal(f.document.documentElement.dataset.theme, 'light'); controller.dispose();
});

test('blocked storage and invalid preferences fall back to system without breaking theme switching', () => {
  const f = fixture(); f.window.localStorage = { getItem() { throw Error('disabled'); }, setItem() { throw Error('disabled'); } };
  const controller = createThemeController(f); controller.set('dark'); assert.equal(f.document.documentElement.dataset.theme, 'dark'); controller.dispose();
  assert.equal(resolveTheme('invalid', true), 'dark'); assert.deepEqual(initializeTheme(undefined, undefined), { preference: 'system', resolved: 'light' });
});
