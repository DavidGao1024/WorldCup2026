/**
 * Cloudflare Worker — 体彩 API 反向代理
 *
 * 作用：绕过腾讯云 EdgeOne WAF 对 GitHub Actions IP 段的拦截
 * 部署：免费，CF 账号 + 粘贴即可，无需 npm/wrangler
 *
 * 部署步骤：
 *   1. 注册/登录 https://dash.cloudflare.com（免费套餐即可）
 *   2. 左侧菜单 → Workers & Pages → Create → Hello World
 *   3. 把本文件全部内容粘贴到编辑器，替换默认代码
 *   4. Save and Deploy → 拿到 URL，形如
 *      https://sporttery-proxy.<你的子域>.workers.dev
 *   5. GitHub 仓库 → Settings → Secrets and variables → Actions
 *      → New repository secret
 *        Name:  ODDS_PROXY_URL
 *        Value: https://sporttery-proxy.<你的子域>.workers.dev
 *   6. 下次 fetch-odds.yml 触发时即走代理
 *
 * 验证：浏览器打开
 *   https://sporttery-proxy.<你的子域>.workers.dev/?poolCode=hhad,had,crsp,ttg,hafu&channel=c
 * 应返回 JSON（含 matchInfoList）
 *
 * 原理：CF Workers 用的是 Cloudflare 自有 IP，不在腾讯云 WAF 黑名单里；
 *       GitHub Actions 调用 Worker URL，Worker 代为请求体彩 API 并返回。
 *
 * 免费额度：CF Workers 免费版每天 10 万次请求，本场景每 15 分钟 1 次 = 96 次/天，绰绰有余。
 */

const UPSTREAM = 'https://webapi.sporttery.cn/gateway/jc/football/getMatchCalculatorV1.qry';

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // 健康检查
    if (url.pathname === '/' && !url.search) {
      return new Response(JSON.stringify({ ok: true, service: 'sporttery-proxy' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // 只允许 GET
    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // 透传 query string 到上游
    const target = UPSTREAM + url.search;

    try {
      const upstream = await fetch(target, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Referer': 'https://www.sporttery.cn/jc/zqsgkj/',
          'Connection': 'keep-alive',
        },
      });

      const body = await upstream.arrayBuffer();
      const headers = new Headers(upstream.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Cache-Control', 'no-store');

      return new Response(body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, upstream: UPSTREAM }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  },
};
