# 🎣 电子鱼护 - Lure Fishbook H5

路亚钓鱼图鉴收集 App，H5 单页演示版。

## 功能特性

- 📖 514 种鱼类图鉴（淡水 / 海水路亚 / 海钓）
- 🔍 AI 鱼种识别（拍照上传，自动识别鱼种）
- 📏 AI 体长估算（参照物辅助）
- 🏆 等级系统：X → B → A → S → SSS
- 🌊 深海暗色主题 UI

## 快速启动

### 1. 安装依赖

```bash
# 无需 npm install，server.js 仅使用 Node.js 内置模块
node --version  # 需要 v16+
```

### 2. 配置 AI 认证

复制配置模板：
```bash
cp config.example.json config.json
```

编辑 `config.json`，填入你的工蜂 AI 认证信息：
```json
{
  "username": "你的工号",
  "oauthToken": "你的 OAUTH-TOKEN",
  "deviceId": "任意 UUID"
}
```

### 3. 启动服务

```bash
node server.js
# 访问 http://localhost:8899
```

### 4. 公网访问（可选）

使用 serveo.net 隧道（无需安装）：
```bash
ssh -R 80:localhost:8899 serveo.net
```

## 文件结构

```
├── index.html      # 前端单页应用（含 514 种鱼数据库）
├── server.js       # Node.js 后端（AI 识别代理 + 静态服务）
├── config.example.json  # 认证配置模板
└── README.md
```

## AI 识别架构

采用**服务端异步识别 + 客户端轮询**方案：

1. 前端 `POST /api/recognize` → 提交图片，立即获得 taskId
2. 服务端异步调用工蜂 Vision API 识别
3. 前端 `GET /api/recog-result?id=taskId` → 每 1.5 秒轮询结果

## 鱼种数据库

- 淡水路亚：201 种
- 海水路亚：181 种  
- 海钓：132 种
- 数据来源：IGFA、FishBase、《Fishes of the World》

## License

MIT
