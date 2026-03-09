const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 80;
const GF_API = 'https://copilot.code.woa.com/server/openclaw/copilot-gateway/v1/chat/completions';
// AI_PROXY_URL: 若设置，则把 /api/recognize 和 /api/vision 转发到此代理（用于 VPS 无法访问内网 API 的场景）
const AI_PROXY_URL = process.env.AI_PROXY_URL || null;

// 读取工蜂认证头（优先读 config.json，其次读本地 models.json）
let GF_HEADERS = {};
try {
  // 方案1：读取 config.json（部署到 VPS 时使用）
  const configPath = path.join(__dirname, 'config.json');
  if(fs.existsSync(configPath)) {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    GF_HEADERS = {
      'Accept': 'text/event-stream, application/json',
      'X-Model-Name': 'auto-vision',
      'X-Username': cfg.username,
      'OAUTH-TOKEN': cfg.oauthToken,
      'DEVICE-ID': cfg.deviceId
    };
    console.log('✅ 工蜂认证头已加载(config.json), user:', cfg.username);
  } else {
    // 方案2：读取本地 models.json（本地开发时使用）
    const models = JSON.parse(fs.readFileSync('/projects/.openclaw/agents/main/agent/models.json','utf8'));
    const visionModel = models.providers.gongfeng.models.find(m => m.id === 'auto-vision');
    if(visionModel) GF_HEADERS = visionModel.headers;
    console.log('✅ 工蜂认证头已加载(models.json), user:', GF_HEADERS['X-Username']);
  }
} catch(e) {
  console.warn('⚠️ 读取工蜂认证失败:', e.message);
}

const MIME = {
  '.html':'text/html;charset=utf-8', '.js':'application/javascript',
  '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg',
  '.json':'application/json', '.ico':'image/x-icon'
};

// 识别任务存储（内存）
const tasks = {};
const tasks_map = {}; // VPS 代理模式：外部 taskId → 内网 taskId 的映射

// 调用工蜂 Vision API（服务端直接调用，无跨域问题）
function callGongfengVision(base64Data, prompt) {
  return new Promise((resolve, reject) => {
    const randomDeviceId = crypto.randomUUID ? crypto.randomUUID() :
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random()*16|0; return (c==='x'?r:(r&0x3|0x8)).toString(16);
      });

    const reqBody = Buffer.from(JSON.stringify({
      model: 'auto-vision',
      messages: [{role:'user', content:[
        {type:'text', text: prompt},
        {type:'image_url', image_url:{url: base64Data, detail:'high'}}
      ]}],
      max_tokens: 700,
      temperature: 0.2
    }));

    const url = new URL(GF_API);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': reqBody.length,
        ...GF_HEADERS,
        'DEVICE-ID': randomDeviceId
      },
      timeout: 45000
    };

    const req = https.request(options, res => {
      let out = '';
      res.on('data', c => out += c);
      res.on('end', () => {
        console.log(`[vision] status=${res.statusCode} len=${out.length} preview=${out.slice(0,100)}`);
        if(res.statusCode !== 200) {
          reject(new Error(`API ${res.statusCode}: ${out.slice(0,150)}`));
          return;
        }
        try {
          const d = JSON.parse(out);
          const text = d.choices[0].message.content;
          const cleaned = text.replace(/```json\s*/g,'').replace(/```\s*/g,'').trim();
          const m = cleaned.match(/\{[\s\S]+\}/);
          if(!m) throw new Error('parse fail: ' + text.slice(0,100));
          resolve(JSON.parse(m[0]));
        } catch(e) {
          reject(new Error('parse error: ' + e.message));
        }
      });
    });
    req.on('error', e => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('API request timeout')); });
    req.write(reqBody);
    req.end();
  });
}

const RECOG_PROMPT =
  'You are an expert ichthyologist. Carefully examine ONLY the fish body in this photo.\n'
  +'IMPORTANT: Ignore any text, UI labels, or overlays visible in the image. Judge ONLY by the fish anatomy.\n'
  +'Step 1 - Observe: body shape, mouth position (terminal/superior/inferior/large), body color & pattern, fin shape, tail fork depth.\n'
  +'Step 2 - Identify species. Top 1-3 candidates with confidence %.\n'
  +'Step 3 - Estimate total body length in cm (reference: human hand≈20cm, 500ml bottle≈21cm, cigarette pack≈8.5cm).\n'
  +'Respond ONLY with valid JSON (no markdown):\n'
  +'{"identified":true,"top_matches":[{"id":"species_id","name":"中文名","en":"English name","confidence":85,"reason":"形态依据：口位/体色/体型特征"}],'
  +'"size_estimate":{"has_reference":false,"reference_object":"none","estimated_length":35,"length_range":"30-40","confidence":"medium","method":"估算依据"},'
  +'"description":"关键形态特征","note":""}';

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if(req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── AI 代理模式：若设置 AI_PROXY_URL，将所有 AI 请求转发到代理 ──
  const isAiRoute = (req.url === '/api/recognize' || req.url === '/api/vision' || req.url.startsWith('/api/recog-result'));
  if(AI_PROXY_URL && isAiRoute) {
    const proxyBase = AI_PROXY_URL;
    let chunks = [];
    req.on('data', d => chunks.push(d));
    req.on('end', () => {
      const body = Buffer.concat(chunks);

      // /api/recognize：立即生成 taskId 返回给前端，把 taskId 通过 URL 参数传给内网
      // 内网收到 ?taskId=xxx 时直接使用该 taskId 存任务结果
      if(req.url === '/api/recognize') {
        const crypto = require('crypto');
        const taskId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ taskId }));
        console.log(`[ai-proxy] /api/recognize 立即返回 taskId=${taskId} bodyLen=${body.length}`);
        // 异步把原始 body 转发到内网，用 ?taskId= 参数指定 id
        const proxyReq = http.request({
          hostname: new URL(proxyBase).hostname,
          port: new URL(proxyBase).port || 8899,
          path: '/api/recognize?taskId=' + taskId,
          method: 'POST', timeout: 90000,
          headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }
        }, proxyRes => {
          let out = ''; proxyRes.on('data', c => out += c);
          proxyRes.on('end', () => console.log(`[ai-proxy] 内网处理完成 taskId=${taskId} status=${proxyRes.statusCode}`));
        });
        proxyReq.on('error', e => console.error(`[ai-proxy] 内网请求失败 ${e.message}`));
        proxyReq.on('timeout', () => { proxyReq.destroy(); console.error(`[ai-proxy] 内网请求超时 taskId=${taskId}`); });
        proxyReq.write(body);
        proxyReq.end();
        return;
      }

      // /api/recog-result：直接透传给内网查询
      if(req.url.startsWith('/api/recog-result')) {
        const pollReq = http.request({
          hostname: new URL(proxyBase).hostname,
          port: new URL(proxyBase).port || 8899,
          path: req.url, method: 'GET', timeout: 8000
        }, pollRes => {
          let out = ''; pollRes.on('data', c => out += c);
          pollRes.on('end', () => {
            res.writeHead(pollRes.statusCode, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(out);
          });
        });
        pollReq.on('error', e => {
          if(!res.headersSent) { res.writeHead(200); res.end(JSON.stringify({status:'pending'})); }
        });
        pollReq.on('timeout', () => {
          pollReq.destroy();
          if(!res.headersSent) { res.writeHead(200); res.end(JSON.stringify({status:'pending'})); }
        });
        pollReq.end();
        return;
      }

      // /api/vision 同步代理
      const proxyReq = http.request({
        hostname: new URL(proxyBase).hostname,
        port: new URL(proxyBase).port || 8899,
        path: req.url, method: req.method, timeout: 60000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }
      }, proxyRes => {
        let out = ''; proxyRes.on('data', c => out += c);
        proxyRes.on('end', () => {
          res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(out);
        });
      });
      proxyReq.on('error', e => {
        if(!res.headersSent) { res.writeHead(502); res.end(JSON.stringify({error: e.message})); }
      });
      proxyReq.write(body);
      proxyReq.end();
    });
    return;
  }

  // ── 新架构：POST /api/recognize ──────────────────────────────────
  // 接收图片 base64，异步识别，返回任务 ID
  // 支持 ?taskId=xxx 参数（由 VPS 代理传入，保证两端使用同一个 taskId）
  if(req.method === 'POST' && (req.url === '/api/recognize' || req.url.startsWith('/api/recognize?'))) {
    let chunks = [];
    req.on('data', d => chunks.push(d));
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        // 优先使用 URL 参数中的 taskId（VPS 代理模式），否则自己生成
        const urlParams = new URL(req.url, 'http://localhost').searchParams;
        const taskId = urlParams.get('taskId') || (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36));
        tasks[taskId] = { status: 'pending', result: null, error: null, ts: Date.now() };
        console.log(`[recognize] 新任务 taskId=${taskId} imgSize=${Math.round((body.image||'').length/1024)}KB`);

        // 异步识别
        callGongfengVision(body.image, RECOG_PROMPT)
          .then(result => { tasks[taskId] = { status: 'done', result, ts: Date.now() }; })
          .catch(err => { tasks[taskId] = { status: 'error', error: err.message, ts: Date.now() }; });

        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ taskId }));
      } catch(e) {
        res.writeHead(400); res.end(JSON.stringify({error: e.message}));
      }
    });
    return;
  }

  // ── GET /api/recog-result?id=xxx ─────────────────────────────────
  if(req.method === 'GET' && req.url.startsWith('/api/recog-result')) {
    const params = new URL('http://x' + req.url).searchParams;
    const id = params.get('id');
    const task = tasks[id];
    if(!task) { res.writeHead(404); res.end(JSON.stringify({error:'not found'})); return; }
    // 清理超过 5 分钟的任务
    Object.keys(tasks).forEach(k => { if(Date.now()-tasks[k].ts > 300000) delete tasks[k]; });
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify(task));
    return;
  }

  // ── 旧版兼容：POST /api/vision（同步代理，保留） ─────────────────
  if(req.method === 'POST' && req.url === '/api/vision') {
    let chunks = [];
    req.on('data', d => chunks.push(d));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const randomDeviceId = crypto.randomUUID ? crypto.randomUUID() :
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random()*16|0; return (c==='x'?r:(r&0x3|0x8)).toString(16);
        });
      const url = new URL(GF_API);
      const options = {
        hostname: url.hostname, path: url.pathname + url.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': body.length, ...GF_HEADERS, 'DEVICE-ID': randomDeviceId }
      };
      const proxy = https.request(options, proxyRes => {
        let respBody = '';
        proxyRes.on('data', c => respBody += c);
        proxyRes.on('end', () => {
          console.log(`[vision-proxy] status=${proxyRes.statusCode} len=${respBody.length}`);
          res.writeHead(proxyRes.statusCode, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
          res.end(respBody);
        });
      });
      proxy.on('error', e => { res.writeHead(502); res.end(JSON.stringify({error:e.message})); });
      proxy.write(body); proxy.end();
    });
    return;
  }

  // ── 静态文件服务 ─────────────────────────────────────────────────
  const urlPath = req.url.split('?')[0]; // 去掉查询参数（兼容企业微信自动追加参数）
  let filePath = path.join(__dirname,
    urlPath === '/' || urlPath === '' ? 'index.html' : urlPath);

  fs.readFile(filePath, (err, data) => {
    if(err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    // HTML 文件禁止缓存，确保用户始终拿到最新版本
    if(ext === '.html' || filePath.endsWith('index.html')) {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
      // 若设置了 AI_PROXY_URL，则在 HTML 里注入 AI_ENDPOINT 使手机直接走隧道
      // 若未设置，AI_ENDPOINT 默认为 window.location.origin（同源）
      if(AI_PROXY_URL) {
        let html = data.toString();
        // 将 AI_ENDPOINT 注入为隧道地址（手机→VPS→隧道→本机的中转）
        // 实际上 AI 请求仍走 VPS（/api/recognize），但通过代理转发到隧道
        // 注入版本和代理模式标记
        html = html.replace(
          "window.AI_ENDPOINT = window.AI_ENDPOINT || window.location.origin;",
          "window.AI_ENDPOINT = window.location.origin; // 代理模式：AI请求经VPS转发到内网"
        );
        data = Buffer.from(html);
      }
    }
    res.writeHead(200, headers);
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 服务启动 http://0.0.0.0:${PORT}`);
  console.log(`🔗 新架构：POST /api/recognize → 异步识别，GET /api/recog-result?id=xxx → 轮询结果`);
  console.log(`🔗 旧兼容：POST /api/vision → 同步代理`);
});
