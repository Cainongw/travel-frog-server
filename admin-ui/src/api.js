let token = '';
const pending = new Map();
const images = new Map();

export function setToken(value) {
  token = value;
  pending.clear();
  images.clear();
}

function operationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export async function api(route, account, options = {}) {
  const params = new URLSearchParams(options.query || {});
  if (account) params.set('account', account);
  const { body } = options;
  const signature = body === undefined ? null : JSON.stringify({ route, account, body });
  if (signature && !pending.has(signature)) pending.set(signature, operationId());
  const headers = { Authorization: `Bearer ${token}` };
  if (signature) {
    headers['Content-Type'] = 'application/json';
    headers['Idempotency-Key'] = pending.get(signature);
  }
  let response;
  try {
    response = await fetch(`/api/admin/${route}${params.size ? '?' + params : ''}`, {
      method: signature ? 'POST' : 'GET', headers,
      body: signature ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw Error('服务器暂时无法连接。请检查连接后重试；相同操作会复用请求编号，避免重复发放。');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (signature && response.status >= 400 && response.status < 500) pending.delete(signature);
    if (response.status === 401) throw Error('管理密钥无效或已更换，请断开后重新连接。');
    throw Error(data.error || `请求失败 (${response.status})`);
  }
  if (signature) pending.delete(signature);
  return data;
}

export function getImage(id) {
  if (!images.has(id)) {
    const promise = fetch(`/api/admin/image/${id}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
    }).then(async response => {
      if (!response.ok) throw Error(`图片资源 ${id} 无法读取`);
      const url = URL.createObjectURL(await response.blob());
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
        image.onerror = () => { URL.revokeObjectURL(url); reject(Error(`图片资源 ${id} 无法解码`)); };
        image.src = url;
      });
    }).catch(error => { images.delete(id); throw error; });
    images.set(id, promise);
  }
  return images.get(id);
}

export function downloadJson(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.replace(/[^\w.\-\u4e00-\u9fff]/g, '_');
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
