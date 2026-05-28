// js/i18n.js
const I18N = {
  zh: {
    title: '2026 世界杯',
    subtitle: '美国 · 加拿大 · 墨西哥',
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
    filterByGroup: '按小组筛选',
    filterByTeam: '按球队筛选',
    matchday: '比赛日'
  },
  en: {
    title: 'World Cup 2026',
    subtitle: 'USA · Canada · Mexico',
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
  location.reload();
}
