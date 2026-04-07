# 破晓镇 · 蚀目之影

一个 LLM 驱动的中文 TRPG 跑团游戏引擎。代码负责规则,LLM 负责叙事。

- **代码层**:数值计算、HP/金币、战斗判定、状态管理、信任度规则、章节推进
- **LLM 层**(DM Agent):场景描写、NPC 对话、氛围营造、自主调用工具推进剧情

支持任何 OpenAI-compatible API(Kimi / DeepSeek / Ollama / vLLM 等),
通过 [open-claude-cli](https://www.npmjs.com/package/open-claude-cli) Agent SDK 接入。

## 快速开始

```bash
git clone <this-repo>
cd trpg-agent
npm install
```

然后**二选一**配置 LLM 凭据,见下文 [配置](#配置)。

启动:

```bash
npm run web        # 推荐:Web 服务,浏览器访问 http://localhost:3000
npm run start      # 备选:终端 CLI 模式
npm run play       # 彩蛋:酒馆骰子小游戏(单独的 demo)
```

## 配置

LLM 凭据有两种配置方式,二选一即可。代码会**优先读取环境变量**,
没有环境变量时回退到 `~/.occ/config.json`。

### 方式 A:环境变量(推荐用于部署)

```bash
cp .env.example .env
# 编辑 .env 填入你的 API key
source .env
npm run web
```

或者直接 `export`:

```bash
export TRPG_API_KEY=sk-xxxxxxxx
export TRPG_BASE_URL=https://your-llm-endpoint/v1
export TRPG_MODEL=moonshotai/Kimi-K2.5
npm run web
```

完整的环境变量列表见 [`.env.example`](.env.example)。

### 方式 B:本地配置文件(推荐用于日常开发)

写入 `~/.occ/config.json`:

```json
{
  "provider": "openai",
  "apiKey": "sk-xxxxxxxx",
  "baseUrl": "https://your-llm-endpoint/v1",
  "model": "moonshotai/Kimi-K2.5"
}
```

部分 endpoint 需要自定义 headers(例如 Kimi coding API 需要伪装 UA):

```json
{
  "provider": "openai",
  "apiKey": "sk-xxxxxxxx",
  "baseUrl": "https://api.kimi.com/coding/v1",
  "model": "kimi-for-coding",
  "headers": {
    "User-Agent": "claude-code/1.0.0",
    "X-Client-Name": "claude-code"
  },
  "streamUsage": false
}
```

### 模型兼容性

DM Agent 通过 open-claude-cli 调用,要求模型支持 **tool use / function calling**
(因为 DM 需要调用 Talk / Move / SetActions 等工具)。已知良好运行的模型:

- Kimi-K2.5(moonshotai)
- DeepSeek-V3 / R1
- Claude 3.5 Sonnet / 4.x(通过 openai-compat proxy)
- 任何支持 OpenAI Function Calling 的本地模型(Llama 3.1+、Qwen2.5+ 等,通过 vLLM/Ollama)

不支持 tool use 的模型(早期 Llama2、纯 chat completion 模型)无法正常运行 DM。

## 开发命令

```bash
npm run web                              # 启动 web 服务(默认端口 3000)
npm run start                            # 启动 CLI 模式
npx tsc --noEmit                         # 类型检查
npx tsx src/combat-manager.test.ts       # 跑战斗系统测试
npx tsx src/rules-engine.test.ts         # 跑规则引擎测试
npx tsx src/combat-ally-ai.test.ts       # 跑同伴 AI 测试
npx tsx src/strip-ansi.test.ts           # 跑 ANSI 剥离测试
```

测试是手写的简易 assert + 计数,直接 `tsx` 跑即可,无 jest/vitest 依赖。

## 项目结构

```
src/
  engine.ts                  # 游戏主引擎(回合处理、事件流)
  dm-agent.ts                # DM Agent 配置(LLM + 工具列表 + system prompt)
  dm-prompt.ts               # DM system prompt 构建
  rules-agent.ts             # 玩家输入分类(SEARCH/MOVE/ATTACK/TALK/...)
  action-executor.ts         # 已分类动作 → 工具调用映射
  trust-system.ts            # NPC 信任度系统
  combat-manager.ts          # 战斗回合管理器
  rules-engine.ts            # 骰子检定 / 规则判定
  audio-config.ts            # BGM/环境音映射
  i18n-terms.ts              # 英中术语流式替换
  game-state.ts              # 全局会话状态
  chapter-manager.ts         # 章节/任务推进
  tools/                     # DM Agent 可用的工具集
  data/                      # 怪物 / NPC / 物品 / 地图 数据
  *.test.ts                  # 测试文件(npx tsx 直接跑)

public/
  index.html                 # 前端 SPA(单文件,~6000 行)
  audio/                     # BGM + 环境音 + SFX
    CREDITS.md               # 音频归属(CC0/CC-BY)
  portraits/                 # NPC 立绘 + 玩家职业立绘

docs/                        # 设计文档
  ARCHITECTURE_SUMMARY.md
  CORE_SYSTEMS.md
  DM_PROMPT_GUIDE.md         # ⚠️ 修改 DM prompt 前必读
  combat-system-design.md
  violence-consequence-design.md
  ...

CLAUDE.md                    # 项目开发规范(给 AI 协作者读)
```

设计哲学和深度细节(信任度系统、暴力后果、章节设计、数值平衡规范)
都在 [`CLAUDE.md`](CLAUDE.md) 和 [`docs/`](docs/) 目录里。

## 不在仓库里的内容

`.gitignore` 会忽略以下内容,克隆时拿不到:

- `node_modules/` — `npm install` 重建
- `saves/` — 玩家存档(`autosave.json` / `quicksave.json` / 命名存档)
- `dist/` — 构建产物(项目用 `tsx` 直接跑 ts 源码,实际不需要)
- `*.env`, `tmp.env` — 本地环境变量
- `~/.occ/config.json` — LLM 凭据(在 home 目录,根本不在 repo 里)

仓库里**没有任何 API key 或敏感凭据**。

## 部署提示

- Web 服务对外暴露时建议设置 `TRPG_PASSWORD`,否则任何人都能访问并消耗你的 LLM 配额
- 默认端口 3000,可用 `PORT` 环境变量覆盖
- 默认 BGM/SFX 文件较大(`public/audio/` ~80MB),如果带宽紧张可考虑用 CDN 或剥离

## 许可

代码:见仓库根目录。
音频/美术资源:见 [`public/audio/CREDITS.md`](public/audio/CREDITS.md),
混合 CC0 / CC-BY,部分资源需要署名(已在 CREDITS.md 标明)。
