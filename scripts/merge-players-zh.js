// scripts/merge-players-zh.js
// 将 data/missing-players-translated.json 合并到 data/players-zh.json 的 players 字段

const fs = require('fs');
const path = require('path');

const playersZhPath = path.join(__dirname, '..', 'data', 'players-zh.json');
const missingPath = path.join(__dirname, '..', 'data', 'missing-players-translated.json');

const playersZh = JSON.parse(fs.readFileSync(playersZhPath, 'utf8'));
const missing = JSON.parse(fs.readFileSync(missingPath, 'utf8'));

const db = playersZh.players || playersZh;

let added = 0;
for (const [name, translation] of Object.entries(missing)) {
  if (!translation) continue;
  if (!db[name]) {
    db[name] = translation;
    added++;
  }
}

// Update total count
playersZh._totalKeys = Object.keys(db).length;
playersZh._generated = new Date().toISOString().split('T')[0];

if (!playersZh.players) {
  playersZh.players = db;
}

fs.writeFileSync(playersZhPath, JSON.stringify(playersZh, null, 2), 'utf8');
console.log(`Merged ${added} new translations. Total keys: ${playersZh._totalKeys}`);
