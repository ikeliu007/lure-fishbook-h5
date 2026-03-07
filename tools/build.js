// 扩展 build 脚本，把 desc/dist/size 也序列化进去
const fs   = require('fs');
const path = require('path');

const DB_PATH   = path.join(__dirname, '../fish_database.json');
const HTML_PATH = path.join(__dirname, '../index.html');

const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));

// 验证
let errCount = 0;
const ids = new Set();
data.forEach((f,i) => {
  if(ids.has(f.id)){ console.error('重复id:',f.id); errCount++; }
  ids.add(f.id);
  if(!f.name||!f.en||!f.cat||!f.icon||!f.t||!f.r){ console.error('字段缺失:',f.id); errCount++; }
});
if(errCount){ console.error('发现错误，中止'); process.exit(1); }

// 序列化，包含 desc/dist/size 字段
function esc(s){ return (s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }
const lines = data.map(f => {
  const lure  = f.lure  ? `,lure:'${esc(f.lure)}'`  : '';
  const desc  = f.desc  ? `,desc:'${esc(f.desc)}'`  : '';
  const dist  = f.dist  ? `,dist:'${esc(f.dist)}'`  : '';
  const size  = f.size  ? `,size:'${esc(f.size)}'`  : '';
  return `{id:'${f.id}',name:'${esc(f.name)}',en:'${esc(f.en)}',cat:'${f.cat}',icon:'${f.icon}',t:{lv2:${f.t.lv2},lv3:${f.t.lv3},lv4:${f.t.lv4}},r:'${f.r}'${lure}${desc}${dist}${size}}`;
}).join(',\n');

let html = fs.readFileSync(HTML_PATH, 'utf8');
const start = html.indexOf('const FISH_DB = [');
const end   = html.indexOf('];', start) + 2;
if(start < 0){ console.error('找不到FISH_DB'); process.exit(1); }

html = html.slice(0, start) + 'const FISH_DB = [\n' + lines + '\n];' + html.slice(end);
fs.writeFileSync(HTML_PATH, html, 'utf8');
console.log('✅ index.html 已更新，共', data.length, '种鱼（含 desc/dist/size 字段）');
