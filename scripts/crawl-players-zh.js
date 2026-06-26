// scripts/crawl-players-zh.js
// 从 2026fifa.tw 爬取48队球员中英文名对照
// 纯 Node.js 内置模块，零依赖
// 输出: data/players-zh.json

var https = require('https');
var fs = require('fs');
var path = require('path');

var TEAM_SLUGS = [
  'algeria', 'argentina', 'australia', 'austria', 'belgium',
  'bosnia-herzegovina', 'brazil', 'canada', 'cape-verde', 'colombia',
  'croatia', 'curacao', 'czech-republic', 'dr-congo', 'ecuador',
  'egypt', 'england', 'france', 'germany', 'ghana',
  'haiti', 'iran', 'iraq', 'ivory-coast', 'japan',
  'jordan', 'mexico', 'morocco', 'netherlands', 'new-zealand',
  'norway', 'panama', 'paraguay', 'portugal', 'qatar',
  'saudi-arabia', 'scotland', 'senegal', 'south-africa', 'south-korea',
  'spain', 'sweden', 'switzerland', 'tunisia', 'turkey',
  'united-states', 'uruguay', 'uzbekistan'
];

var BASE = 'https://2026fifa.tw/squad-';

// 提取 squad list 中的 "中文名（English Name，Club）" 模式
// 只从 <li> 标签中提取，避免正文段落中的噪音
function extractPlayers(html) {
  // 移除 script/style/noscript
  var clean = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  clean = clean.replace(/<style[\s\S]*?<\/style>/gi, '');
  clean = clean.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  // 只提取 <li>...</li> 中的内容
  var liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  var liMatch;
  var allLiText = [];

  while ((liMatch = liRe.exec(clean)) !== null) {
    // 去掉 li 内部的 <a>, <span> 等标签
    var text = liMatch[1].replace(/<[^>]+>/g, '').trim();
    if (text) allLiText.push(text);
  }

  if (allLiText.length === 0) {
    // fallback: 没有 li 标签，尝试全文但只取紧邻的模式
    allLiText.push(clean.replace(/<[^>]+>/g, ' '));
  }

  // 匹配: 中文名（English Name，Club）或 C罗（Cristiano Ronaldo，Club）
  // 中文名可能含：汉字、．、·、拉丁字母(C罗/B费等)、空格
  var re = /([\u4e00-\u9fffA-Z][\u4e00-\u9fffA-Za-z．·\u00b7\-\s]{0,30})[（(]([A-Z][A-Za-z\s'\-\.]{2,40})[，,）)]/g;
  var players = [];
  var seen = {};

  for (var t = 0; t < allLiText.length; t++) {
    var lineText = allLiText[t];
    var match;
    while ((match = re.exec(lineText)) !== null) {
      var zhName = match[1].trim();
      var enName = match[2].trim();

      // 清理中文名
      zhName = zhName.replace(/[．·\u00b7]/g, '·');
      zhName = zhName.replace(/\s+/g, '');

      // 基本过滤
      if (zhName.length < 2) continue;
      if (zhName.length > 15) continue;
      if (enName.length > 30) continue;

      // 过滤非球员项（球队名、标题等）
      if (/^(门将|后卫|中场|前锋|名单|小组|世界|国家|总教|教練|教练|小组赛|完整|上一|下一|文章|最新|热门|阿根廷|巴西|德国|法国|西班牙|英格兰|意大利|葡萄牙|荷兰|比利时|克罗地亚|日本|韩国|墨西哥|美国|加拿大|澳洲|澳大利亚|伊朗|沙特|卡塔尔|突尼斯|摩洛哥|塞内加尔|加纳|喀麦隆|阿尔及利亚|埃及|尼日利亚|科特迪瓦|南非|瑞典|挪威|丹麦|波兰|瑞士|奥地|塞尔维亚|乌拉圭|哥伦|智利|秘鲁|厄瓜多尔|巴拉圭|新西兰|哥斯达|巴拿马|洪都|牙买加|伊拉克|约旦|乌兹别克|阿联酋|中国|印度|泰国|越南|马来西亚|新加坡|印尼|菲律宾|苏格兰|威尔斯|北爱尔兰|爱尔兰|捷克|斯洛伐克|匈牙利|罗马尼亚|保加利亚|乌克兰|俄罗斯|土耳其|希腊|芬兰|冰岛|以色列)$/.test(zhName)) continue;
      // 过滤含「隊」「組」「賽」「盃」的，基本是标题文本
      if (/[隊組賽盃冠亞季決選名單]/.test(zhName) && zhName.length > 4) continue;

      var key = enName.toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;

      players.push({ en: enName, zh: zhName });
    }
  }

  return players;
}

// 常用繁→简转换表（球员名常用字）
var T2S_MAP = {
  '門': '门', '後': '后', '衛': '卫', '將': '将', '軍': '军',
  '鋒': '锋', '場': '场', '陣': '阵', '線': '线', '隊': '队',
  '賽': '赛', '盃': '杯', '爾': '尔', '亞': '亚', '維': '维',
  '羅': '罗', '馬': '马', '蘭': '兰', '盧': '卢', '貝': '贝',
  '爾': '尔', '喬': '乔', '納': '纳', '薩': '萨', '萊': '莱',
  '萬': '万', '倫': '伦', '遜': '逊', '澤': '泽', '庫': '库',
  '維': '维', '裡': '里', '岡': '冈', '頓': '顿', '維': '维',
  '蘇': '苏', '達': '达', '奧': '奥', '傑': '杰', '勞': '劳',
  '魯': '鲁', '諾': '诺', '華': '华', '費': '费', '龍': '龙',
  '漢': '汉', '賓': '宾', '聖': '圣', '邁': '迈', '凱': '凯',
  '維': '维', '茲': '兹', '爾': '尔', '爾': '尔', '爾': '尔',
  '貝': '贝', '尼': '尼', '迪': '迪', '科': '科', '利': '利',
  '斯': '斯', '特': '特', '夫': '夫', '姆': '姆', '巴': '巴',
  '卡': '卡', '德': '德', '拉': '拉', '雷': '雷', '弗': '弗',
  '托': '托', '克': '克', '裡': '里', '奇': '奇', '耶': '耶',
  '內': '内', '岡': '冈', '韋': '韦', '茨': '茨', '扎': '扎',
  '倫': '伦', '爾': '尔', '鮑': '鲍', '烏': '乌', '約': '约',
  '維': '维', '奧': '奥', '頓': '顿', '維': '维', '爾': '尔',
  '蒂': '蒂', '爾': '尔', '維': '维', '納': '纳', '爾': '尔',
  '讓': '让', '託': '托', '貝': '贝', '維': '维', '爾': '尔',
  '岡': '冈', '茲': '兹', '諾': '诺', '貝': '贝', '爾': '尔',
  '爾': '尔', '維': '维', '裡': '里', '岡': '冈', '爾': '尔',
  '貝': '贝', '維': '维', '爾': '尔', '裡': '里', '特': '特',
  '岡': '冈', '維': '维', '爾': '尔', '裡': '里', '爾': '尔',
  '貝': '贝', '維': '维', '爾': '尔', '裡': '里', '爾': '尔',
  '蘇': '苏', '維': '维', '馬': '马', '爾': '尔', '裡': '里',
  // 更多常见繁简字
  '國': '国', '際': '际', '體': '体', '個': '个', '時': '时',
  '來': '来', '對': '对', '動': '动', '現': '现', '實': '实',
  '開': '开', '關': '关', '發': '发', '會': '会', '學': '学',
  '長': '长', '東': '东', '風': '风', '電': '电', '點': '点',
  '見': '见', '說': '说', '話': '话', '語': '语', '讀': '读',
  '寫': '写', '買': '买', '賣': '卖', '車': '车', '過': '过',
  '進': '进', '還': '还', '這': '这', '為': '为', '嗎': '吗',
  '謝': '谢', '讓': '让', '認': '认', '識': '识', '記': '记',
  '請': '请', '誰': '谁', '該': '该', '應': '应', '當': '当',
  '從': '从', '沒': '没', '著': '着', '裡': '里', '後': '后',
  '前': '前', '能': '能', '可': '可', '會': '会', '要': '要',
  '也': '也', '都': '都', '去': '去', '和': '和', '與': '与',
  '或': '或', '但': '但', '而': '而', '所': '所', '以': '以',
  '之': '之', '其': '其', '此': '此', '於': '于', '被': '被',
  '把': '把', '讓': '让', '向': '向', '將': '将', '則': '则',
  '如': '如', '若': '若', '因': '因', '故': '故', '所': '所',
  '巴': '巴', '西': '西', '阿': '阿', '根': '根', '廷': '廷',
  '英': '英', '格': '格', '蘭': '兰', '葡': '葡', '萄': '萄',
  '牙': '牙', '意': '意', '大': '大', '利': '利', '荷': '荷',
  '蘭': '兰', '法': '法', '國': '国', '西': '西', '班': '班',
  '牙': '牙', '德': '德', '比': '比', '利': '利', '時': '时',
  '克': '克', '羅': '罗', '地': '地', '亞': '亚', '塞': '塞',
  '爾': '尔', '維': '维', '亞': '亚', '烏': '乌', '拉': '拉',
  '圭': '圭', '智': '智', '哥': '哥', '倫': '伦', '比': '比',
  '亞': '亚', '墨': '墨', '西': '西', '哥': '哥', '美': '美',
  '國': '国', '加': '加', '拿': '拿', '大': '大', '澳': '澳',
  '紐': '纽', '西': '西', '蘭': '兰', '韓': '韩', '國': '国',
  '日': '日', '本': '本', '中': '中', '國': '国', '沙': '沙',
  '特': '特', '伊': '伊', '朗': '朗', '卡': '卡', '塔': '塔',
  '爾': '尔', '阿': '阿', '聯': '联', '酋': '酋', '埃': '埃',
  '及': '及', '南': '南', '非': '非', '尼': '尼', '日': '日',
  '利': '利', '亞': '亚', '喀': '喀', '麥': '麦', '隆': '隆',
  '突': '突', '尼': '尼', '斯': '斯', '摩': '摩', '洛': '洛',
  '哥': '哥', '塞': '塞', '內': '内', '加': '加', '爾': '尔',
  '丹': '丹', '麥': '麦', '挪': '挪', '威': '威', '瑞': '瑞',
  '典': '典', '芬': '芬', '冰': '冰', '島': '岛', '俄': '俄',
  '羅': '罗', '斯': '斯', '烏': '乌', '克': '克', '蘭': '兰',
  '波': '波', '蘭': '兰', '捷': '捷', '克': '克', '斯': '斯',
  '洛': '洛', '伐': '伐', '匈': '匈', '牙': '牙', '利': '利',
  '羅': '罗', '馬': '马', '尼': '尼', '亞': '亚', '保': '保',
  '加': '加', '利': '利', '亞': '亚', '希': '希', '臘': '腊',
  '土': '土', '耳': '耳', '其': '其', '愛': '爱', '爾': '尔',
  '蘭': '兰', '威': '威', '爾': '尔', '斯': '斯', '蘇': '苏',
  '格': '格', '蘭': '兰', '格': '格', '林': '林', '納': '纳',
  '達': '达', '茲': '兹', '岡': '冈', '薩': '萨', '爾': '尔',
  '維': '维', '奇': '奇', '耶': '耶', '夫': '夫', '娃': '娃',
  '伊': '伊', '萬': '万', '諾': '诺', '夫': '夫', '維': '维',
  '揚': '扬', '庫': '库', '爾': '尔', '茲': '兹', '維': '维',
  '澤': '泽', '科': '科', '夫': '夫', '斯': '斯', '基': '基',
  '赫': '赫', '拉': '拉', '德': '德', '曼': '曼', '恩': '恩',
  '森': '森', '伯': '伯', '格': '格', '布': '布', '朗': '朗',
  '查': '查', '理': '理', '克': '克', '斯': '斯', '頓': '顿',
  '登': '登', '普': '普', '金': '金', '霍': '霍', '華': '华',
  '倫': '伦', '納': '纳', '多': '多', '姆': '姆', '安': '安',
  '尼': '尼', '魯': '鲁', '塞': '塞', '馬': '马', '克': '克',
  '斯': '斯', '丁': '丁', '奇': '奇', '茲': '兹', '科夫': '科夫',
  '諾夫': '诺夫', '斯基': '斯基', '維奇': '维奇', '耶夫': '耶夫',
  '紹': '绍', '紹': '绍', '切': '切', '凱': '凯', '維': '维',
};

function t2s(text) {
  var result = '';
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    result += T2S_MAP[c] || c;
  }
  return result;
}

// 生成 shortName: "Lionel Messi" → "L. Messi"
function makeShortName(fullName) {
  var parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return fullName; // 单名如 Rodrygo
  var firstInitial = parts[0].charAt(0).toUpperCase();
  var rest = parts.slice(1).join(' ');
  return firstInitial + '. ' + rest;
}

// Get team name from slug for logging
function teamName(slug) {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
}

function fetchPage(slug) {
  return new Promise(function(resolve, reject) {
    var url = BASE + slug + '/';
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, function(res) {
      if (res.statusCode !== 200) {
        console.log('  HTTP ' + res.statusCode + ' for ' + slug);
        resolve('');
        return;
      }
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { resolve(Buffer.concat(chunks).toString()); });
    }).on('error', function(e) {
      console.log('  Error: ' + e.message + ' for ' + slug);
      resolve('');
    });
  });
}

function sleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

async function main() {
  console.log('爬取 2026fifa.tw 球员中英文名...\n');

  var allPlayers = {};
  var stats = [];

  for (var i = 0; i < TEAM_SLUGS.length; i++) {
    var slug = TEAM_SLUGS[i];
    var name = teamName(slug);
    process.stdout.write('[' + (i + 1) + '/' + TEAM_SLUGS.length + '] ' + name + '... ');

    var html = await fetchPage(slug);
    if (!html) {
      console.log('✗ 无数据');
      stats.push({ team: name, count: 0 });
      continue;
    }

    var players = extractPlayers(html);
    var count = 0;

    for (var j = 0; j < players.length; j++) {
      var p = players[j];
      // 以 displayName 为 key（中文名做繁→简转换）
      var zhSimp = t2s(p.zh);
      if (!allPlayers[p.en]) {
        allPlayers[p.en] = zhSimp;
        count++;
      }
      // 同时生成 shortName key
      var sn = makeShortName(p.en);
      if (sn !== p.en && !allPlayers[sn]) {
        allPlayers[sn] = zhSimp;
        count++;
      }
      // 处理无点号简写变体: "L Messi" (ESPN 有时用)
      var parts = p.en.trim().split(/\s+/);
      if (parts.length > 1) {
        var noDot = parts[0].charAt(0) + ' ' + parts.slice(1).join(' ');
        if (noDot !== sn && !allPlayers[noDot]) {
          allPlayers[noDot] = zhSimp;
        }
      }
    }

    console.log(players.length + ' 球员, ' + count + ' keys');
    stats.push({ team: name, count: players.length });

    // 礼貌延迟，避免被限流
    if (i < TEAM_SLUGS.length - 1) await sleep(500);
  }

  // 输出统计
  console.log('\n=== 汇总 ===');
  var totalKeys = Object.keys(allPlayers).length;
  var totalPlayers = stats.reduce(function(s, t) { return s + t.count; }, 0);
  console.log('球队: ' + stats.length);
  console.log('球员 keys: ' + totalKeys);
  console.log('球队统计:');
  stats.forEach(function(s) {
    if (s.count === 0) console.log('  ⚠ ' + s.team + ': 0 球员');
  });

  // 生成 JSON
  var output = {
    _note: '2026世界杯48队球员中英文名对照。Key为ESPN displayName/shortName，Value为简体中文译名。来源: 2026fifa.tw（已繁→简转换）',
    _generated: new Date().toISOString().substring(0, 10),
    _source: 'https://2026fifa.tw/world-cup-2026-squads-announced/',
    _totalKeys: totalKeys,
    players: allPlayers
  };

  var outPath = path.join(__dirname, '..', 'data', 'players-zh.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  console.log('\n写入: ' + outPath);
  console.log('完成!');
}

main().catch(function(e) {
  console.error('失败:', e);
  process.exit(1);
});
