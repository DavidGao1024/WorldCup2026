/**
 * 从中国体彩官方 API 获取世界杯竞彩赔率数据
 *
 * 用法: node scripts/fetch-odds.js
 * 输出: data/lottery-odds.json
 *
 * 纯 Node.js 内置模块，无需 npm install
 */

const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ========== 配置 ==========
// 默认直连体彩 API；GitHub Actions 中通过 ODDS_PROXY_URL 环境变量切换为 CF Worker 代理
// （腾讯云 WAF 自 2026-07-05 起拦截 GitHub Actions IP 段，需走 Cloudflare Workers 反代）
const API_URL = process.env.ODDS_PROXY_URL
  ? process.env.ODDS_PROXY_URL.replace(/\/$/, '')
  : 'https://webapi.sporttery.cn/gateway/jc/football/getMatchCalculatorV1.qry';
const POOL_CODES = 'hhad,had,crs,ttg,hafu';
const OUTPUT_FILE = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', 'data', 'lottery-odds.json');
const REQUEST_TIMEOUT = 15000;

// ========== 工具函数 ==========
function fetch(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: REQUEST_TIMEOUT,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate',
        'Referer': 'https://www.sporttery.cn/jc/zqsgkj/',
        'Connection': 'keep-alive'
      }
    }, (res) => {
      const chunks = [];
      let stream = res;

      if (res.headers['content-encoding'] === 'gzip') {
        stream = res.pipe(zlib.createGunzip());
      } else if (res.headers['content-encoding'] === 'deflate') {
        stream = res.pipe(zlib.createInflate());
      }

      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        resolve(body);
      });
      stream.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.on('error', reject);
  });
}

function parseOddsEntry(entry) {
  const result = { poolCode: entry.poolCode, updateTime: entry.updateTime };

  if (entry.poolCode === 'HAD' || entry.poolCode === 'HHAD') {
    result.h = parseFloat(entry.h) || null;
    result.d = parseFloat(entry.d) || null;
    result.a = parseFloat(entry.a) || null;
    if (entry.poolCode === 'HHAD') {
      result.goalLine = entry.goalLine || null;
    }
  } else if (entry.poolCode === 'CRS') {
    // 比分玩法：odds 字段是逗号分隔的赔率串
    // 格式示例: "6.50,7.00,8.00,..." 对应各比分结果
    if (entry.odds) {
      result.odds = entry.odds;
    }
    // 也可能在 goalLine/h/d/a 中有数据
    if (entry.h) result.h = parseFloat(entry.h) || null;
    if (entry.d) result.d = parseFloat(entry.d) || null;
    if (entry.a) result.a = parseFloat(entry.a) || null;
  } else if (entry.poolCode === 'TTG') {
    // 总进球玩法：8种结果(0,1,2,3,4,5,6,7+)
    if (entry.odds) {
      result.odds = entry.odds;
    }
    if (entry.h) result.h = parseFloat(entry.h) || null;
    if (entry.d) result.d = parseFloat(entry.d) || null;
    if (entry.a) result.a = parseFloat(entry.a) || null;
  } else if (entry.poolCode === 'HAFU') {
    // 半全场玩法：9种结果(胜胜,胜平,胜负,平胜,平平,平负,负胜,负平,负负)
    if (entry.odds) {
      result.odds = entry.odds;
    }
    if (entry.h) result.h = parseFloat(entry.h) || null;
    if (entry.d) result.d = parseFloat(entry.d) || null;
    if (entry.a) result.a = parseFloat(entry.a) || null;
  }

  return result;
}

function extractMatchOdds(match) {
  const pools = {};

  // 从 oddsList 中提取（这是主要数据来源）
  if (match.oddsList && Array.isArray(match.oddsList)) {
    match.oddsList.forEach((entry) => {
      const parsed = parseOddsEntry(entry);
      if (!pools[parsed.poolCode]) {
        pools[parsed.poolCode] = parsed;
      }
    });
  }

  // 也用 match 级别的 had/hhad 做补充（这些有时更完整）
  if (match.had && match.had.h) {
    if (!pools.HAD) {
      pools.HAD = { poolCode: 'HAD' };
    }
    pools.HAD.h = pools.HAD.h || parseFloat(match.had.h) || null;
    pools.HAD.d = pools.HAD.d || parseFloat(match.had.d) || null;
    pools.HAD.a = pools.HAD.a || parseFloat(match.had.a) || null;
    pools.HAD.updateTime = pools.HAD.updateTime || match.had.updateTime || '';
  }

  if (match.hhad && match.hhad.h) {
    if (!pools.HHAD) {
      pools.HHAD = { poolCode: 'HHAD' };
    }
    pools.HHAD.h = pools.HHAD.h || parseFloat(match.hhad.h) || null;
    pools.HHAD.d = pools.HHAD.d || parseFloat(match.hhad.d) || null;
    pools.HHAD.a = pools.HHAD.a || parseFloat(match.hhad.a) || null;
    pools.HHAD.goalLine = pools.HHAD.goalLine || match.hhad.goalLine || null;
    pools.HHAD.updateTime = pools.HHAD.updateTime || match.hhad.updateTime || '';
  }

  // TTG 总进球：8个选项 (s0~s7 = 0球~7+球)
  if (match.ttg && (match.ttg.s0 || match.ttg.s1)) {
    if (!pools.TTG) {
      pools.TTG = { poolCode: 'TTG' };
    }
    pools.TTG.s0 = parseFloat(match.ttg.s0) || null;
    pools.TTG.s1 = parseFloat(match.ttg.s1) || null;
    pools.TTG.s2 = parseFloat(match.ttg.s2) || null;
    pools.TTG.s3 = parseFloat(match.ttg.s3) || null;
    pools.TTG.s4 = parseFloat(match.ttg.s4) || null;
    pools.TTG.s5 = parseFloat(match.ttg.s5) || null;
    pools.TTG.s6 = parseFloat(match.ttg.s6) || null;
    pools.TTG.s7 = parseFloat(match.ttg.s7) || null;
    pools.TTG.updateTime = pools.TTG.updateTime || match.ttg.updateTime || '';
  }

  // CRS 比分：31个具体比分 + 3个"其他比分"
  // 格式: s{HH}s{AA} = 主队HH球:客队AA球 (如 s01s02 = 1:2)
  // s1sa=其他主胜, s1sd=其他平局, s1sh=其他客胜
  // f后缀字段为标记位，跳过
  if (match.crs && Object.keys(match.crs).some(k => k.startsWith('s') && !k.endsWith('f') && k !== 'goalLine' && k !== 'goalLineValue' && k !== 'updateDate' && k !== 'updateTime')) {
    if (!pools.CRS) {
      pools.CRS = { poolCode: 'CRS' };
    }
    Object.keys(match.crs).forEach(function(key) {
      if (key.endsWith('f') || key === 'goalLine' || key === 'goalLineValue' || key === 'updateDate' || key === 'updateTime') return;
      pools.CRS[key] = parseFloat(match.crs[key]) || null;
    });
    pools.CRS.updateTime = pools.CRS.updateTime || match.crs.updateTime || '';
  }

  // HAFU 半全场：9个选项
  // hh=胜胜 hd=胜平 ha=胜负 dh=平胜 dd=平平 da=平负 ah=负胜 ad=负平 aa=负负
  if (match.hafu && (match.hafu.hh || match.hafu.dd)) {
    if (!pools.HAFU) {
      pools.HAFU = { poolCode: 'HAFU' };
    }
    pools.HAFU.hh = parseFloat(match.hafu.hh) || null;
    pools.HAFU.hd = parseFloat(match.hafu.hd) || null;
    pools.HAFU.ha = parseFloat(match.hafu.ha) || null;
    pools.HAFU.dh = parseFloat(match.hafu.dh) || null;
    pools.HAFU.dd = parseFloat(match.hafu.dd) || null;
    pools.HAFU.da = parseFloat(match.hafu.da) || null;
    pools.HAFU.ah = parseFloat(match.hafu.ah) || null;
    pools.HAFU.ad = parseFloat(match.hafu.ad) || null;
    pools.HAFU.aa = parseFloat(match.hafu.aa) || null;
    pools.HAFU.updateTime = pools.HAFU.updateTime || match.hafu.updateTime || '';
  }

  return pools;
}

function transformData(raw) {
  const matchInfoList = raw.value && raw.value.matchInfoList;
  if (!matchInfoList || !Array.isArray(matchInfoList)) {
    throw new Error('API 返回数据结构异常：缺少 matchInfoList');
  }

  const matches = [];

  matchInfoList.forEach((day) => {
    const subList = day.subMatchList;
    if (!subList || !Array.isArray(subList)) return;

    subList.forEach((m) => {
      if (m.leagueCode !== 'WCC') return; // 只取世界杯

      const matchData = {
        matchNum: m.matchNum,
        matchNumStr: m.matchNumStr || '',
        matchDate: m.matchDate || '',
        matchTime: m.matchTime || '',
        homeTeam: m.homeTeamAllName || '',
        awayTeam: m.awayTeamAllName || '',
        homeTeamEn: m.homeTeamAbbEnName || '',
        awayTeamEn: m.awayTeamAbbEnName || '',
        homeRank: m.homeRank || '',
        awayRank: m.awayRank || '',
        venue: m.remark || '',
        status: m.matchStatus || '',
        pools: extractMatchOdds(m),
        availablePools: (m.poolList || []).filter(function(p) { return p.poolStatus === 'Selling'; }).map(function(p) {
          return { poolCode: p.poolCode, bettingSingle: p.bettingSingle, bettingAllup: p.bettingAllup };
        })
      };

      matches.push(matchData);
    });
  });

  return matches;
}

// ========== 主流程 ==========
async function main() {
  console.log(`[${new Date().toISOString()}] 开始获取体彩赔率数据...`);

  const url = `${API_URL}?poolCode=${POOL_CODES}&channel=c`;
  let rawBody;
  try {
    rawBody = await fetch(url);
    console.log('  API 请求成功');
  } catch (err) {
    console.error('  API 请求失败:', err.message);
    process.exit(1);
  }

  let rawData;
  try {
    rawData = JSON.parse(rawBody);
  } catch (err) {
    console.error('  JSON 解析失败:', err.message);
    console.error('  返回内容前200字符:', rawBody.slice(0, 200));
    process.exit(1);
  }

  if (!rawData.success || rawData.errorCode !== '0') {
    console.error('  API 返回错误:', rawData.errorMessage || '未知错误');
    process.exit(1);
  }

  const matches = transformData(rawData);

  const output = {
    updateTime: new Date().toISOString(),
    source: 'sporttery.cn',
    matchCount: matches.length,
    matches: matches
  };

  const outputDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  console.log(`  成功: ${matches.length} 场比赛赔率已写入 ${OUTPUT_FILE}`);
  console.log(`  玩法覆盖: ${matches.map(m => Object.keys(m.pools)).flat().filter((v,i,a) => a.indexOf(v)===i).join(', ')}`);

  // 简要输出每场比赛
  matches.forEach((m) => {
    const poolKeys = Object.keys(m.pools);
    const hadPool = m.pools.HAD;
    const hhadPool = m.pools.HHAD;
    let summary = `  ${m.matchNumStr} ${m.homeTeam} vs ${m.awayTeam}`;
    if (hadPool && hadPool.h) {
      summary += ` | HAD: ${hadPool.h}/${hadPool.d}/${hadPool.a}`;
    }
    if (hhadPool && hhadPool.h) {
      const gl = hhadPool.goalLine ? `(${hhadPool.goalLine})` : '';
      summary += ` | HHAD${gl}: ${hhadPool.h}/${hhadPool.d}/${hhadPool.a}`;
    }
    summary += ` | 玩法: ${poolKeys.join(',')}`;
    console.log(summary);
  });
}

main();
