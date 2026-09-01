/**
 * Cloudflare Worker — 体彩 API 反向代理（双端点：赔率 + 赛果）
 *
 * 作用：绕过腾讯云 EdgeOne WAF 对 GitHub Actions IP 段的拦截
 * 部署：免费，CF 账号 + 粘贴即可，无需 npm/wrangler
 *
 * 路由（两个消费端脚本零改动，按各自拼 URL 方式自动匹配）：
 *   GET /                     健康检查
 *   GET /?poolCode=...        赔率计算接口（fetch-odds.js 以 ODDS_PROXY_URL 为基址拼查询串）
 *   GET /gateway/jc/...       同名透传（daily-advisor.js fetchOdds）
 *   GET /gateway/uniform/...  同名透传（daily-advisor.js fetchResults 赛果）
 *   其余路径一律 404 —— 不做开放代理
 *
 * 部署步骤：
 *   1. dash.cloudflare.com → Workers & Pages → Create → Hello World
 *   2. 编辑器里默认代码全部删掉，粘贴本文件全部内容 → Save and Deploy
 *   3. 拿到 URL：https://<worker名>.<子域>.workers.dev
 *   4. GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret
 *        Name:  ODDS_PROXY_URL
 *        Value: https://<worker名>.<子域>.workers.dev
 *   5. 下次 fetch-odds.yml 触发即走代理
 *
 * 部署后验证（浏览器直接打开）：
 *   赔率: https://<worker>.workers.dev/?poolCode=hhad,had&channel=c
 *         → 应返回含 matchInfoList 的 JSON
 *   赛果: https://<worker>.workers.dev/gateway/uniform/football/getUniformMatchResultV1.qry?matchBeginDate=2026-08-31&matchEndDate=2026-08-31&pageSize=30&pageNo=1&isFix=0&matchPage=1&pcOrWap=1
 *         → 应返回含 matchResult 的 JSON
 *
 * 原理：CF Workers 出口 IP 不在腾讯云 WAF 黑名单里；Actions 调 Worker，Worker 代请求体彩 API。
 * 免费额度：10 万次/天，本场景约 96 次/天，零头。
 */

const UPSTREAM = 'https://webapi.sporttery.cn';
const CALCULATOR = '/gateway/jc/football/getMatchCalculatorV1.qry';
const ALLOWED = new Set([
  CALCULATOR,
  '/gateway/uniform/football/getUniformMatchResultV1.qry',
]);

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/' && !url.search) {
      return json({ ok: true, service: 'sporttery-proxy', routes: [...ALLOWED] });
    }
    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // fetch-odds.js 兼容：根路径 + 查询串 = 赔率计算接口
    const targetPath = url.pathname === '/' ? CALCULATOR : url.pathname;
    if (!ALLOWED.has(targetPath)) {
      return json({ error: 'path not allowed', allowed: [...ALLOWED] }, 404);
    }

    try {
      const upstream = await fetch(UPSTREAM + targetPath + url.search, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Referer': 'https://www.sporttery.cn/jc/zqsgkj/',
          'Origin': 'https://www.sporttery.cn',
          'Connection': 'keep-alive',
        },
      });

      const headers = new Headers(upstream.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Cache-Control', 'no-store');

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    } catch (err) {
      return json({ error: err.message, upstream: UPSTREAM + targetPath }, 502);
    }
  },
};
