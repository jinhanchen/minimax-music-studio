/**
 * 生成记录的持久化。
 *
 * 因为一首歌要跑几十分钟，用户必然会关掉浏览器再回来 —— 所有任务状态
 * 都必须落盘，不能只活在内存或前端里。
 *
 * 写入用「临时文件 + rename」原子替换，避免断电/崩溃留下半个 JSON。
 * 所有更新返回新对象，不就地修改。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { LIBRARY_FILE } from './config.js';

/** @typedef {'queued'|'running'|'done'|'error'|'canceled'} JobStatus */

let cache = null;

const emptyLibrary = () => ({ version: 1, jobs: [] });

async function ensureDir() {
  await fs.mkdir(path.dirname(LIBRARY_FILE), { recursive: true });
}

export async function load() {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(LIBRARY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    cache = Array.isArray(parsed?.jobs) ? parsed : emptyLibrary();
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // 文件损坏时保留现场再重建，绝不静默丢数据
      console.error('[library] 索引损坏，已备份为 .bak 并重建：', err.message);
      await fs.rename(LIBRARY_FILE, `${LIBRARY_FILE}.bak`).catch(() => {});
    }
    cache = emptyLibrary();
  }
  return cache;
}

async function persist(next) {
  await ensureDir();
  const tmp = `${LIBRARY_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
  await fs.rename(tmp, LIBRARY_FILE);
  cache = next;
}

export async function listJobs() {
  const lib = await load();
  return lib.jobs;
}

export async function getJob(id) {
  const lib = await load();
  return lib.jobs.find((j) => j.id === id) ?? null;
}

export async function addJob(job) {
  const lib = await load();
  const next = { ...lib, jobs: [job, ...lib.jobs] };
  await persist(next);
  return job;
}

/**
 * 按 id 更新任务，返回更新后的副本；不存在时返回 null。
 * patch 会浅合并到原对象上，原对象不被修改。
 */
export async function updateJob(id, patch) {
  const lib = await load();
  let updated = null;
  const jobs = lib.jobs.map((job) => {
    if (job.id !== id) return job;
    updated = { ...job, ...patch, updatedAt: new Date().toISOString() };
    return updated;
  });
  if (!updated) return null;
  await persist({ ...lib, jobs });
  return updated;
}

export async function removeJob(id) {
  const lib = await load();
  const jobs = lib.jobs.filter((j) => j.id !== id);
  if (jobs.length === lib.jobs.length) return false;
  await persist({ ...lib, jobs });
  return true;
}

/** 服务重启后，把"还在跑"的任务捡回来继续盯 */
export async function findUnfinished() {
  const lib = await load();
  return lib.jobs.filter((j) => j.status === 'queued' || j.status === 'running');
}
