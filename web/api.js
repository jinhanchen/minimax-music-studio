/** 后端 API 封装。所有网络细节收敛在这里。 */

async function req(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { error: text }; }
  }
  if (!res.ok) {
    const err = new Error(data?.error ?? `请求失败（HTTP ${res.status}）`);
    err.detail = data?.detail;
    err.field = data?.field;
    throw err;
  }
  return data;
}

export const getHealth   = () => req('/api/health');
export const getConfig   = () => req('/api/config');
export const listJobs    = () => req('/api/jobs');
export const createJob   = (payload) => req('/api/jobs', { method: 'POST', body: JSON.stringify(payload) });
export const cancelJob   = (id) => req(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
export const deleteJob   = (id) => req(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const estimate    = (duration, coldStart) =>
  req('/api/estimate', { method: 'POST', body: JSON.stringify({ duration, coldStart }) });

export const audioUrl    = (id, download = false) =>
  `/api/jobs/${encodeURIComponent(id)}/audio${download ? '?download=1' : ''}`;
