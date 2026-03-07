#!/usr/bin/env node
/**
 * 鱼种数据库维护工具
 * 用法:
 *   node db-manage.js check          # 质量检查
 *   node db-manage.js list [cat] [r] # 列出鱼种 (cat: fresh/salt/sea, r: common/rare/...)
 *   node db-manage.js add            # 交互式新增鱼种
 *   node db-manage.js edit <id>      # 修正某条记录
 *   node db-manage.js remove <id>    # 删除鱼种
 *   node db-manage.js build          # 从JSON重新生成 index.html 里的FISH_DB
 *   node db-manage.js export <file>  # 导出为CSV或JSON
 *   node db-manage.js stats          # 统计报告
 */

const fs   = require('fs');
const path = require('path');
const readline = require('readline');

const DB_PATH   = path.join(__dirname, '..', 'fish_database.json');
const HTML_PATH = path.join(__dirname, '..', 'index.html');

const CATS   = ['fresh', 'salt', 'sea'];
const RARITY = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const CAT_LABEL = { fresh:'淡水路亚', salt:'海水路亚', sea:'远洋海钓' };
const R_LABEL   = { common:'普通', uncommon:'良品', rare:'稀有', epic:'史诗', legendary:'传说' };

// ─── 颜色输出 ───────────────────────────────────────────
const C = {
  reset:'\x1b[0m', bold:'\x1b[1m',
  red:'\x1b[31m', green:'\x1b[32m', yellow:'\x1b[33m',
  blue:'\x1b[34m', cyan:'\x1b[36m', gray:'\x1b[90m',
};
const ok  = s => console.log(C.green+'✅ '+s+C.reset);
const err = s => console.log(C.red+'❌ '+s+C.reset);
const warn= s => console.log(C.yellow+'⚠️  '+s+C.reset);
const info= s => console.log(C.cyan+'ℹ️  '+s+C.reset);
const hdr = s => console.log('\n'+C.bold+C.blue+s+C.reset);

// ─── 读写数据库 ──────────────────────────────────────────
function loadDB() {
  if (!fs.existsSync(DB_PATH)) { err('找不到 fish_database.json'); process.exit(1); }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  ok(`数据库已保存 (${data.length} 种鱼)`);
}

// ─── 校验单条记录 ────────────────────────────────────────
function validateFish(f, idx) {
  const problems = [];
  if (!f.id || !/^[a-z0-9_]+$/.test(f.id))    problems.push(`id 格式错误: "${f.id}"`);
  if (!f.name || f.name.length < 2)             problems.push('name 为空或太短');
  if (!f.en   || f.en.length < 2)               problems.push('en 为空或太短');
  if (!CATS.includes(f.cat))                    problems.push(`cat 非法值: "${f.cat}"`);
  if (!f.icon || f.icon.length < 1)             problems.push('icon 缺失');
  if (!f.t || !f.t.lv2 || !f.t.lv3 || !f.t.lv4) problems.push('t 阈值不完整');
  else {
    if (f.t.lv2 >= f.t.lv3) problems.push(`lv2(${f.t.lv2}) >= lv3(${f.t.lv3})`);
    if (f.t.lv3 >= f.t.lv4) problems.push(`lv3(${f.t.lv3}) >= lv4(${f.t.lv4})`);
  }
  if (!RARITY.includes(f.r))                    problems.push(`r 非法值: "${f.r}"`);
  return problems;
}

// ─── COMMAND: check ──────────────────────────────────────
function cmdCheck() {
  hdr('🔍 数据库质量检查');
  const data = loadDB();
  const ids   = new Map();
  const names = new Map();
  let totalErrors = 0, totalWarns = 0;

  data.forEach((f, i) => {
    const problems = validateFish(f, i);

    // 检查重复
    if (ids.has(f.id))   problems.push(`重复 id: 与第${ids.get(f.id)+1}条冲突`);
    else ids.set(f.id, i);
    if (names.has(f.name)) {
      warn(`[第${i+1}条] 重复中文名 "${f.name}" ← 同 id:${names.get(f.name)}`);
      totalWarns++;
    } else names.set(f.name, f.id);

    // 缺 lure 字段警告
    if (!f.lure) { warn(`[${f.id}] 缺少 lure 字段`); totalWarns++; }

    if (problems.length > 0) {
      err(`[第${i+1}条 id:${f.id}] ${problems.join(' | ')}`);
      totalErrors += problems.length;
    }
  });

  hdr('📊 检查结果');
  console.log(`总鱼种: ${C.bold}${data.length}${C.reset}`);
  console.log(`错误数: ${totalErrors > 0 ? C.red : C.green}${totalErrors}${C.reset}`);
  console.log(`警告数: ${totalWarns  > 0 ? C.yellow : C.green}${totalWarns}${C.reset}`);
  if (totalErrors === 0 && totalWarns === 0) ok('数据库完全干净 🎉');
}

// ─── COMMAND: stats ──────────────────────────────────────
function cmdStats() {
  hdr('📈 数据库统计');
  const data = loadDB();
  const byCat = {fresh:[], salt:[], sea:[]};
  const byR   = {common:[], uncommon:[], rare:[], epic:[], legendary:[]};

  data.forEach(f => {
    if (byCat[f.cat]) byCat[f.cat].push(f);
    if (byR[f.r])     byR[f.r].push(f);
  });

  console.log(`\n总鱼种: ${C.bold}${data.length}${C.reset}\n`);
  console.log('── 按分类 ──');
  CATS.forEach(c => {
    const bar = '█'.repeat(Math.round(byCat[c].length/data.length*30));
    console.log(`  ${CAT_LABEL[c].padEnd(8)} ${String(byCat[c].length).padStart(4)} 种  ${C.cyan}${bar}${C.reset}`);
  });
  console.log('\n── 按稀有度 ──');
  const rColors = {common:C.gray, uncommon:C.green, rare:C.blue, epic:C.yellow, legendary:C.red};
  RARITY.forEach(r => {
    const bar = '█'.repeat(Math.round(byR[r].length/data.length*30));
    console.log(`  ${rColors[r]}${R_LABEL[r].padEnd(4)}${C.reset} ${String(byR[r].length).padStart(4)} 种  ${rColors[r]}${bar}${C.reset}`);
  });

  hdr('🏆 传说级鱼种清单');
  byR.legendary.forEach(f =>
    console.log(`  ${C.red}${f.name}${C.reset} (${f.en}) [${CAT_LABEL[f.cat]}]`)
  );
}

// ─── COMMAND: list ───────────────────────────────────────
function cmdList(cat, rarity) {
  const data = loadDB();
  let filtered = data;
  if (cat    && CATS.includes(cat))    filtered = filtered.filter(f => f.cat === cat);
  if (rarity && RARITY.includes(rarity)) filtered = filtered.filter(f => f.r === rarity);

  hdr(`📋 鱼种列表 [${cat||'全部'}] [${rarity||'全部稀有度'}] — 共${filtered.length}条`);
  const rColors = {common:C.gray, uncommon:C.green, rare:C.blue, epic:C.yellow, legendary:C.red};
  filtered.forEach((f, i) => {
    const rC = rColors[f.r] || '';
    console.log(
      `  ${String(i+1).padStart(3)}. ${f.icon} ${C.bold}${f.name}${C.reset}`.padEnd(30) +
      `  ${C.gray}${f.en}${C.reset}`.padEnd(45) +
      `  ${rC}${R_LABEL[f.r]}${C.reset}`.padEnd(15) +
      `  ${C.gray}${CAT_LABEL[f.cat]}${C.reset}` +
      (f.lure ? `  ${C.gray}[${f.lure}]${C.reset}` : '')
    );
  });
}

// ─── COMMAND: add ────────────────────────────────────────
async function cmdAdd() {
  hdr('➕ 新增鱼种');
  const data = loadDB();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(res => rl.question(C.cyan + q + C.reset, res));

  try {
    console.log('字段说明: id(唯一英文下划线), name(中文), en(英文), cat(fresh/salt/sea),');
    console.log('          icon(emoji), lv2/lv3/lv4(体长cm升级阈值), r(稀有度), lure(钓法)\n');

    const id   = (await ask('id (英文唯一标识): ')).trim().toLowerCase().replace(/\s+/g,'_');
    if (data.find(f => f.id === id)) { err(`id "${id}" 已存在！`); rl.close(); return; }

    const name = (await ask('中文名: ')).trim();
    if (data.find(f => f.name === name)) warn(`中文名 "${name}" 已存在，请确认是否重复`);

    const en   = (await ask('英文名: ')).trim();
    const cat  = (await ask('分类 (fresh/salt/sea): ')).trim();
    if (!CATS.includes(cat)) { err('cat 非法'); rl.close(); return; }

    const icon = (await ask('图标 emoji: ')).trim();
    const lv2  = parseInt(await ask('lv2 体长 cm (良品): '));
    const lv3  = parseInt(await ask('lv3 体长 cm (史诗): '));
    const lv4  = parseInt(await ask('lv4 体长 cm (传说): '));
    if (lv2 >= lv3 || lv3 >= lv4) { err('体长阈值必须 lv2 < lv3 < lv4'); rl.close(); return; }

    const r    = (await ask('稀有度 (common/uncommon/rare/epic/legendary): ')).trim();
    if (!RARITY.includes(r)) { err('r 非法'); rl.close(); return; }

    const lure = (await ask('推荐钓法 (可留空): ')).trim();

    const newFish = { id, name, en, cat, icon, t:{lv2, lv3, lv4}, r };
    if (lure) newFish.lure = lure;

    console.log('\n即将添加:');
    console.log(JSON.stringify(newFish, null, 2));
    const confirm = (await ask('\n确认添加? (y/n): ')).trim().toLowerCase();
    if (confirm !== 'y') { info('已取消'); rl.close(); return; }

    data.push(newFish);
    saveDB(data);
    info('记得运行 node db-manage.js build 更新 index.html');
  } finally {
    rl.close();
  }
}

// ─── COMMAND: edit ───────────────────────────────────────
async function cmdEdit(id) {
  hdr(`✏️  修正鱼种: ${id}`);
  const data = loadDB();
  const idx  = data.findIndex(f => f.id === id);
  if (idx < 0) { err(`找不到 id: ${id}`); return; }

  const fish = data[idx];
  console.log('当前数据:');
  console.log(JSON.stringify(fish, null, 2));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q, def) => new Promise(res =>
    rl.question(C.cyan + q + (def ? ` [${def}]: ` : ': ') + C.reset, ans => res(ans.trim() || def))
  );

  try {
    console.log('\n直接回车保留原值\n');
    fish.name = await ask('中文名', fish.name);
    fish.en   = await ask('英文名', fish.en);
    fish.cat  = await ask('分类 (fresh/salt/sea)', fish.cat);
    fish.icon = await ask('图标 emoji', fish.icon);
    fish.t.lv2 = parseInt(await ask('lv2', fish.t.lv2));
    fish.t.lv3 = parseInt(await ask('lv3', fish.t.lv3));
    fish.t.lv4 = parseInt(await ask('lv4', fish.t.lv4));
    fish.r    = await ask('稀有度', fish.r);
    fish.lure = await ask('推荐钓法', fish.lure || '');

    const problems = validateFish(fish, idx);
    if (problems.length > 0) {
      problems.forEach(p => err(p));
      const force = await ask('存在问题，强制保存? (y/n)', 'n');
      if (force !== 'y') { info('已取消'); rl.close(); return; }
    }

    data[idx] = fish;
    saveDB(data);
    info('记得运行 node db-manage.js build 更新 index.html');
  } finally {
    rl.close();
  }
}

// ─── COMMAND: remove ─────────────────────────────────────
async function cmdRemove(id) {
  hdr(`🗑  删除鱼种: ${id}`);
  const data = loadDB();
  const idx  = data.findIndex(f => f.id === id);
  if (idx < 0) { err(`找不到 id: ${id}`); return; }

  console.log('将删除:', JSON.stringify(data[idx]));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const confirm = await new Promise(res => rl.question(C.red+'确认删除? (y/n): '+C.reset, res));
  rl.close();

  if (confirm.trim().toLowerCase() !== 'y') { info('已取消'); return; }
  data.splice(idx, 1);
  saveDB(data);
  info('记得运行 node db-manage.js build 更新 index.html');
}

// ─── COMMAND: build ──────────────────────────────────────
function cmdBuild() {
  hdr('🔨 重建 index.html FISH_DB');

  // 先做一次 check
  const data = loadDB();
  const ids  = new Set();
  let errCount = 0;
  data.forEach((f, i) => {
    const p = validateFish(f, i);
    if (ids.has(f.id)) p.push('重复id');
    ids.add(f.id);
    if (p.length) { err(`[${f.id}]: ${p.join(' | ')}`); errCount++; }
  });
  if (errCount > 0) {
    err(`发现 ${errCount} 个错误，请先修复再 build`);
    process.exit(1);
  }

  // 序列化为 JS 行
  const lines = data.map(f => {
    const lure = f.lure ? `,lure:'${f.lure.replace(/'/g, "\\'")}'` : '';
    return `{id:'${f.id}',name:'${f.name}',en:'${f.en.replace(/'/g, "\\'")}',cat:'${f.cat}',icon:'${f.icon}',t:{lv2:${f.t.lv2},lv3:${f.t.lv3},lv4:${f.t.lv4}},r:'${f.r}'${lure}}`;
  }).join(',\n');

  let html = fs.readFileSync(HTML_PATH, 'utf8');
  const start = html.indexOf('const FISH_DB = [');
  const end   = html.indexOf('];', start) + 2;
  if (start < 0) { err('在 index.html 中找不到 FISH_DB！'); process.exit(1); }

  html = html.slice(0, start) + 'const FISH_DB = [\n' + lines + '\n];' + html.slice(end);
  fs.writeFileSync(HTML_PATH, html, 'utf8');

  ok(`index.html 已更新，共 ${data.length} 种鱼`);
}

// ─── COMMAND: export ─────────────────────────────────────
function cmdExport(outFile) {
  const data = loadDB();
  const ext  = (outFile || '').split('.').pop().toLowerCase();

  if (ext === 'csv' || !outFile) {
    const file = outFile || 'fish_export.csv';
    const header = 'id,name,en,cat,icon,lv2,lv3,lv4,rarity,lure';
    const rows = data.map(f =>
      [f.id, f.name, f.en, f.cat, f.icon, f.t.lv2, f.t.lv3, f.t.lv4, f.r, f.lure||'']
        .map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')
    );
    fs.writeFileSync(file, header + '\n' + rows.join('\n'), 'utf8');
    ok(`已导出 CSV: ${file} (${data.length} 行)`);
  } else {
    fs.writeFileSync(outFile, JSON.stringify(data, null, 2), 'utf8');
    ok(`已导出 JSON: ${outFile} (${data.length} 种)`);
  }
}

// ─── COMMAND: search ─────────────────────────────────────
function cmdSearch(keyword) {
  hdr(`🔎 搜索: "${keyword}"`);
  const data = loadDB();
  const kw   = keyword.toLowerCase();
  const hits = data.filter(f =>
    f.id.includes(kw) || f.name.includes(keyword) || f.en.toLowerCase().includes(kw) || (f.lure||'').includes(keyword)
  );
  if (hits.length === 0) { info('无结果'); return; }
  hits.forEach(f => {
    console.log(`  ${f.icon} ${C.bold}${f.name}${C.reset} (${f.en}) [id:${f.id}] [${CAT_LABEL[f.cat]}] [${R_LABEL[f.r]}]`);
    if (f.lure) console.log(`     推荐钓法: ${C.gray}${f.lure}${C.reset}`);
  });
  info(`共 ${hits.length} 条匹配`);
}

// ─── 主入口 ──────────────────────────────────────────────
const [,, cmd, arg1, arg2] = process.argv;

(async () => {
  switch (cmd) {
    case 'check':   cmdCheck(); break;
    case 'stats':   cmdStats(); break;
    case 'list':    cmdList(arg1, arg2); break;
    case 'add':     await cmdAdd(); break;
    case 'edit':    if (!arg1) { err('用法: edit <id>'); break; } await cmdEdit(arg1); break;
    case 'remove':  if (!arg1) { err('用法: remove <id>'); break; } await cmdRemove(arg1); break;
    case 'build':   cmdBuild(); break;
    case 'export':  cmdExport(arg1); break;
    case 'search':  if (!arg1) { err('用法: search <关键词>'); break; } cmdSearch(arg1); break;
    default:
      console.log(`
${C.bold}🐟 鱼种数据库维护工具${C.reset}

用法:
  node db-manage.js check              质量检查（零错误才能 build）
  node db-manage.js stats              统计报告 + 传说级清单
  node db-manage.js list [cat] [r]     列出鱼种
  node db-manage.js search <关键词>   搜索鱼种
  node db-manage.js add               交互式新增鱼种
  node db-manage.js edit <id>         修正某条记录
  node db-manage.js remove <id>       删除鱼种
  node db-manage.js build             从 JSON 重建 index.html FISH_DB
  node db-manage.js export [file]     导出 CSV/JSON

分类值: fresh(淡水路亚) / salt(海水路亚) / sea(远洋海钓)
稀有度: common / uncommon / rare / epic / legendary
`);
  }
})();
