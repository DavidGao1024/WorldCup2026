/**
 * Cloudflare Worker — 云端补出触发中继（「每日推荐」页签「补出今日票」按钮的后端）
 *
 * 作用：前端持口令 → Worker 校验并限次 → 改写 Gitee 私密库 shadow 的 PROBE.md
 *       → 该库 yml `triggers.trigger: push` 起班 → shadow.sh issue 模式幂等补出。
 * 部署：CF dash → Workers & Pages → Create Worker → 粘贴本文件 → Save and Deploy
 * 环境变量（Settings → Variables，全部按 Secret 存）：
 *   DISPATCH_PASS  补出口令（必填）
 *   GITEE_TOKEN    Gitee 令牌，需 projects 权限（与 config.sh 同一枚；轮换须两处同改）
 *   GITEE_OWNER    默认 gao-jiashun
 *   GITEE_REPO     默认 shadow
 * KV 绑定：DISPATCH_KV（Storage → KV → 新建命名空间 → 绑定变量名 DISPATCH_KV）
 *
 * 路由：
 *   GET  /           健康检查 → {ok, service, day, used, limit}
 *   POST /dispatch   body {pass} → 触发补出
 *
 * 红线：本文件不含任何明文密钥；令牌/口令只在 Worker 环境变量里。
 */

const PROBE_PATH = 'PROBE.md';
const DAILY_LIMIT = 3;          // 每日触发上限（北京日）
const FAIL_COOLDOWN_SEC = 60;   // 口令错后的冷却

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Cache-Control': 'no-store',
    },
  });
}

function bjDay() {
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
}
function bjHHMM() {
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 16).replace(':', '');
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function b64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

async function gitee(env, path, init) {
  const owner = env.GITEE_OWNER || 'gao-jiashun';
  const repo = env.GITEE_REPO || 'shadow';
  return fetch(`https://gitee.com/api/v5/repos/${owner}/${repo}/${path}`, {
    ...init,
    headers: {
      'Authorization': `token ${env.GITEE_TOKEN}`,
      'User-Agent': 'wc-shadow-trigger',
      'Content-Type': 'application/json',
      ...((init && init.headers) || {}),
    },
  });
}

async function dispatchUpstream(env) {
  const got = await gitee(env, `contents/${PROBE_PATH}`);
  if (!got.ok) return { ok: false, status: got.status, step: 'get' };
  const cur = await got.json();
  if (!cur || !cur.sha) return { ok: false, status: 502, step: 'sha' };
  const put = await gitee(env, `contents/${PROBE_PATH}`, {
    method: 'PUT',
    body: JSON.stringify({
      content: b64(`trigger probe ${bjHHMM()} manual`),
      sha: cur.sha,
      message: `chore: manual dispatch ${bjDay()} ${bjHHMM()}`,
    }),
  });
  return { ok: put.ok, status: put.status, step: 'put' };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return json({ ok: true });

    const day = bjDay();

    if (url.pathname === '/' && request.method === 'GET') {
      const used = Number((await env.DISPATCH_KV.get(`d:${day}`)) || 0);
      return json({ ok: true, service: 'shadow-trigger', day, used, limit: DAILY_LIMIT });
    }
    if (url.pathname !== '/dispatch' || request.method !== 'POST') {
      return json({ error: 'not found' }, 404);
    }

    let pass = '';
    try {
      pass = String((await request.json()).pass || '');
    } catch (e) {
      pass = '';
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (await env.DISPATCH_KV.get(`f:${ip}`)) {
      return json({ error: '尝试过于频繁，请 60 秒后再试' }, 429);
    }
    if (!env.DISPATCH_PASS || !safeEqual(pass, env.DISPATCH_PASS)) {
      await env.DISPATCH_KV.put(`f:${ip}`, '1', { expirationTtl: FAIL_COOLDOWN_SEC });
      return json({ error: '口令不正确' }, 401);
    }

    const used = Number((await env.DISPATCH_KV.get(`d:${day}`)) || 0);
    if (used >= DAILY_LIMIT) {
      return json({ error: `今日触发次数已用尽（上限 ${DAILY_LIMIT} 次）`, day, used }, 429);
    }

    const r = await dispatchUpstream(env);
    if (!r.ok) {
      return json({ error: `云端触发失败（Gitee API ${r.status}）`, step: r.step }, 502);
    }

    await env.DISPATCH_KV.put(`d:${day}`, String(used + 1), { expirationTtl: 172800 });
    return json({ ok: true, day, used: used + 1, limit: DAILY_LIMIT, acceptedAt: new Date().toISOString() });
  },
};