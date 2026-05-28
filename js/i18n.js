// js/i18n.js
const I18N = {
  zh: {
    title: '2026 世界杯',
    subtitle: '大卫的世界杯数据库',
    schedule: '赛程',
    standings: '积分榜',
    knockout: '淘汰赛',
    group: '小组',
    team: '球队',
    played: '赛',
    won: '胜',
    drawn: '平',
    lost: '负',
    gf: '进球',
    ga: '失球',
    gd: '净胜',
    pts: '积分',
    timezone: '时区',
    beijing: '北京时间',
    eastern: '美东时间',
    gmt: '格林威治',
    allGroups: '全部小组',
    allTeams: '全部球队',
    groupStage: '小组赛',
    knockoutStage: '淘汰赛',
    roundOf32: '32强赛',
    roundOf16: '16强赛',
    quarterFinal: '四分之一决赛',
    semiFinal: '半决赛',
    thirdPlace: '三四名决赛',
    final: '决赛',
    vs: 'vs',
    dataSource: '数据来源',
    noData: '暂无数据',
    advanced: '晋级',
    today: '今天',
    champions: '历届冠军',
    filterByGroup: '按小组筛选',
    filterByTeam: '按球队筛选',
    matchday: '比赛日'
  },
  en: {
    title: 'World Cup 2026',
    subtitle: 'David\'s World Cup Database',
    schedule: 'Schedule',
    standings: 'Standings',
    knockout: 'Knockout',
    group: 'Group',
    team: 'Team',
    played: 'P',
    won: 'W',
    drawn: 'D',
    lost: 'L',
    gf: 'GF',
    ga: 'GA',
    gd: 'GD',
    pts: 'Pts',
    timezone: 'Timezone',
    beijing: 'Beijing (UTC+8)',
    eastern: 'US Eastern (UTC-4)',
    gmt: 'GMT (UTC+0)',
    allGroups: 'All Groups',
    allTeams: 'All Teams',
    groupStage: 'Group Stage',
    knockoutStage: 'Knockout Stage',
    roundOf32: 'Round of 32',
    roundOf16: 'Round of 16',
    quarterFinal: 'Quarter-finals',
    semiFinal: 'Semi-finals',
    thirdPlace: 'Third Place',
    final: 'Final',
    vs: 'vs',
    dataSource: 'Data Source',
    noData: 'No data',
    advanced: 'Advances',
    today: 'Today',
    champions: 'Past Champions',
    filterByGroup: 'Filter by group',
    filterByTeam: 'Filter by team',
    matchday: 'Matchday'
  }
};

let currentLang = localStorage.getItem('wc-lang') || 'zh';

function t(key) {
  return I18N[currentLang]?.[key] || I18N.en[key] || key;
}

function toggleLang() {
  currentLang = currentLang === 'zh' ? 'en' : 'zh';
  localStorage.setItem('wc-lang', currentLang);
  updateUIText();
  populateFilters();
  refreshCurrentTab();
}

// Team and venue Chinese translations
var TEAM_ZH = {
  'Mexico': '墨西哥', 'South Africa': '南非', 'South Korea': '韩国', 'Czech Republic': '捷克',
  'Canada': '加拿大', 'Bosnia & Herzegovina': '波黑', 'Qatar': '卡塔尔', 'Switzerland': '瑞士',
  'Brazil': '巴西', 'Morocco': '摩洛哥', 'Haiti': '海地', 'Scotland': '苏格兰',
  'USA': '美国', 'Paraguay': '巴拉圭', 'Australia': '澳大利亚', 'Turkey': '土耳其',
  'Germany': '德国', 'Cura\u00e7ao': '库拉索', 'Ivory Coast': '科特迪瓦', 'Ecuador': '厄瓜多尔',
  'Netherlands': '荷兰', 'Japan': '日本', 'Sweden': '瑞典', 'Tunisia': '突尼斯',
  'Belgium': '比利时', 'Egypt': '埃及', 'Iran': '伊朗', 'New Zealand': '新西兰',
  'Spain': '西班牙', 'Cape Verde': '佛得角', 'Saudi Arabia': '沙特', 'Uruguay': '乌拉圭',
  'France': '法国', 'Senegal': '塞内加尔', 'Iraq': '伊拉克', 'Norway': '挪威',
  'Argentina': '阿根廷', 'Algeria': '阿尔及利亚', 'Austria': '奥地利', 'Jordan': '约旦',
  'Portugal': '葡萄牙', 'DR Congo': '刚果(金)', 'Uzbekistan': '乌兹别克斯坦', 'Colombia': '哥伦比亚',
  'England': '英格兰', 'Croatia': '克罗地亚', 'Ghana': '加纳', 'Panama': '巴拿马',
  'Ukraine': '乌克兰', 'Denmark': '丹麦', 'Serbia': '塞尔维亚', 'Chile': '智利',
  'Russia': '俄罗斯', 'Hungary': '匈牙利', 'Czechoslovakia': '捷克斯洛伐克',
  'Peru': '秘鲁', 'Mali': '马里', 'Italy': '意大利', 'Poland': '波兰'
};

var VENUE_ZH = {
  'Mexico City': '墨西哥城', 'Guadalajara (Zapopan)': '瓜达拉哈拉', 'Atlanta': '亚特兰大',
  'Monterrey (Guadalupe)': '蒙特雷', 'Toronto': '多伦多',
  'San Francisco Bay Area (Santa Clara)': '旧金山湾区', 'Los Angeles (Inglewood)': '洛杉矶',
  'Vancouver': '温哥华', 'Seattle': '西雅图',
  'New York/New Jersey (East Rutherford)': '纽约/新泽西', 'Boston (Foxborough)': '波士顿',
  'Philadelphia': '费城', 'Miami (Miami Gardens)': '迈阿密', 'Houston': '休斯顿',
  'Kansas City': '堪萨斯城', 'Dallas (Arlington)': '达拉斯'
};

function trTeam(name) {
  if (currentLang !== 'zh') return name;
  if (!name) return name;
  if (name[0] === 'W') return name.replace('W', '胜者');
  if (name[0] === 'L') return name.replace('L', '败者');
  if (/^\d[A-Z]/.test(name)) {
    return name.replace(/^(\d)([A-Z])/, function(_, n, g) {
      return g + '组第' + n + '名';
    }).replace(/\//g, '/');
  }
  if (name.indexOf('/') !== -1) {
    return name.split('/').map(function(s) { return TEAM_ZH[s.trim()] || s.trim(); }).join('/');
  }
  return TEAM_ZH[name] || name;
}

function trVenue(name) {
  if (currentLang !== 'zh') return name;
  return VENUE_ZH[name] || name;
}
