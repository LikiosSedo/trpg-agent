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

> `npm install` 会自动通过 `postinstall` 触发 `scripts/fetch-assets.mjs`,
> 从 GitHub Release 下载约 200 MB 的 BGM/立绘资源到 `public/audio/` 和
> `public/portraits/`。详见下方 [资源](#资源bgm--美术) 一节。

## 配置

LLM 凭据有两种配置方式,二选一即可。代码会**优先读取环境变量**,
没有环境变量时回退到 `~/.occ/config.json`。

### 方式 A:环境变量(推荐用于部署)

直接 `export`(或写进 `.env` / 部署平台的 secret 配置):

```bash
export TRPG_API_KEY=sk-xxxxxxxx
export TRPG_BASE_URL=https://your-llm-endpoint/v1   # OpenAI-compatible endpoint
export TRPG_MODEL=moonshotai/Kimi-K2.5
npm run web
```

支持的环境变量:
- `TRPG_API_KEY` (必填)
- `TRPG_BASE_URL` (必填,OpenAI-compatible endpoint)
- `TRPG_MODEL` (默认 `moonshotai/Kimi-K2.5`)
- `TRPG_PROVIDER_TYPE` (默认 `openai`)
- `TRPG_HEADERS` (可选,JSON 字符串,某些 endpoint 需要伪装 UA)
- `TRPG_STREAM_USAGE` (可选,设 `false` 关闭 stream usage 元数据上报)
- `PORT` (Web 服务端口,默认 3000)
- `TRPG_PASSWORD` (可选,设置后 web 入口要求密码)

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

## 资源(BGM / 美术)

为了让 git 仓库保持轻量,音频(~135 MB)和美术立绘(~57 MB)**不直接提交进 git**,
而是通过 [GitHub Releases](https://github.com/LikiosSedo/trpg-agent/releases) 分发。

### 自动获取(默认)

`npm install` 会触发 `scripts/fetch-assets.mjs`,它会:

1. 读 [`assets-manifest.json`](assets-manifest.json) 的当前资源版本
2. 从 GitHub Release 流式下载 tarball
3. 校验 sha256
4. 用系统 `tar` 解压到 `public/audio/` 和 `public/portraits/`

下载约 30-60 秒,看网速。失败不会阻塞 `npm install`,只打 warning。

### 手动管理

```bash
npm run fetch-assets             # 已存在则跳过
npm run fetch-assets -- --force  # 强制重新下载所有 pack
SKIP_ASSETS=1 npm install        # 跳过资源下载(只关心代码时)
```

### 严格模式(production / CI / Render)

`fetch-assets.mjs` 默认在 fetch 失败时只 warning + `exit 0`,避免本地开发时
网络抖动打断 `npm install`。但在 production 部署上这是危险的:fetch 失败但
build 仍然成功,会导致容器跑起来后所有 mp3/png 都 404。

**严格模式下任何 pack 失败 → `exit 1`**,让 build/CI/deploy 整体失败、触发
告警。触发条件(任一即可):

| 环境变量 | 何时设置 | 来源 |
|---|---|---|
| `STRICT_ASSETS=1` | 显式开关 | 你自己设 |
| `RENDER=true` | Render 部署时自动设置 | Render 平台 |
| `CI=true` | 各类 CI/CD 平台自动设置 | GitHub Actions / GitLab / CircleCI / Render 等 |

也就是说**部署到 Render 时不需要任何额外配置**,严格模式会自动启用。

### 在 Render 上部署的注意事项

当前 trpg-agent 在 Render 上的成功配置:

```
Build Command:  npm install
Start Command:  npx tsx src/server.ts
Auto-Deploy:    On Commit
```

`npm install` 会自动触发 `postinstall` → `fetch-assets.mjs`,因为
`RENDER=true`(Render 自动注入)严格模式 ON,fetch 失败 deploy 会直接 fail。

**Render Free 套餐磁盘占用估算**(总约 540 MB,在 1 GB 限额内):

- `node_modules/` ~138 MB
- `public/audio/` ~143 MB(下载并解压后)
- `public/portraits/` ~56 MB
- 临时 tarball 在解压后会被脚本删除,峰值短暂占用额外 ~190 MB
- 代码本身 < 5 MB

### 资源版本管理

每次资源更新会发布一个新的 `assets-vN` Release tag,manifest 同步更新版本号
和 sha256。资源版本是不可变的:`assets-v1` 永远是同一份内容。

打新版本的流程(只有 maintainer 需要):

```bash
# 1. 在 public/audio/ 或 public/portraits/ 改好资源（换 mp3 / 加立绘等）

# 2. 一键发布（打包 → sha256 → gh release → 重写 manifest）
npm run publish-assets

# 3. review manifest diff，确认无误后提交
git add assets-manifest.json
git commit -m "assets: bump to v2 — 换草药堂 BGM"
git push   # → Render auto-deploy 自动拉新 release
```

`scripts/publish-assets.mjs` 自动:
- 读 `assets-manifest.json` 推算下一个版本号(`v1` → `v2`)
- 检查 GitHub release 是否已存在(防止覆盖)
- 用固定的 tar 命令打包(消除 `--exclude` 写错的可能)
- 计算 sha256
- `gh release create` 上传
- 用 Node 重写 manifest,**保留 `verifyPath` 等字段**
- **不自动 commit/push**,你看 diff 决定

支持的参数:

```bash
npm run publish-assets -- --dry-run         # 只打包+sha,不上传不改 manifest
npm run publish-assets -- --version v5      # 跳过自动版本号,显式指定
npm run publish-assets -- --notes "..."     # 自定义 release notes
npm run publish-assets -- --skip-clean-check
```

前置条件:`gh` CLI 已安装并 `gh auth login`。

### 资源校验

`npm run verify-assets` 检查本地 `public/audio/` `public/portraits/` 是否
与 manifest 一致(逐文件 path + size 对比,**不算 sha 因为 tar 打包带 mtime
不确定**)。

文件清单存在独立的 [`assets-filelist.json`](assets-filelist.json) 里
(~48 KB,404 个文件 entry),**故意不内嵌进 `assets-manifest.json`**,
让 `git diff assets-manifest.json` 时干净易读 —— 主 manifest 只有 23 行
元数据,filelist 只在 verify-assets / publish-assets 真正用到。

```bash
npm run verify-assets             # 校验,问题时 exit 1
npm run verify-assets -- --quiet  # 静默模式(供 hook 用)
npm run verify-assets -- --rebuild  # 把当前工作区写回 manifest fileList
                                    # (manifest 没 fileList 时一次性 backfill)
```

校验内容:
- 每个 pack 的 `verifyPath` 文件存在
- `manifest.packs[].fileList` 里的每个文件存在 + size 匹配
- 工作区里有 manifest 不知道的额外文件(可能是漏 publish 的新资源)

### Pre-commit hook(可选)

为了防止"改了资源但忘了 publish",项目提供一个 git pre-commit hook
作为软提示。**它不阻塞 commit**,只在资源不一致时打一段提示。

```bash
npm run install-hooks         # 一次性安装(创建 .git/hooks/pre-commit 符号链接)
```

效果:每次 `git commit` 时自动跑 `verify-assets --quiet`,有差异时打:

```
ℹ pre-commit note: 资源与 assets-manifest.json 不一致
    [verify-assets] audio: ✗ 1 个文件大小不匹配:
        - public/audio/town-day.mp3  期望 1316581 字节, 实际 1316580 字节
    如果是有意改资源,记得发布新版本:
        npm run publish-assets
        git add assets-manifest.json
    此提示不阻塞 commit。设 SKIP_ASSET_HOOK=1 可跳过本 hook。
```

跳过方式:
- 单次:`git commit --no-verify`
- 全局:`SKIP_ASSET_HOOK=1 git commit ...`
- 卸载:`rm .git/hooks/pre-commit`

### CREDITS

资源里只有 `*.md` 文档(`CREDITS.md`、prompt 文档等)留在 git 仓库里,
方便 review 和归属追踪。完整的 BGM 出处见 [`public/audio/CREDITS.md`](public/audio/CREDITS.md)。

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
- `public/audio/*.{mp3,ogg,wav}` `public/portraits/*.png` — 资源,通过
  GitHub Release 分发(见 [资源](#资源bgm--美术) 一节)

仓库里**没有任何 API key 或敏感凭据**。

## 部署提示

- Web 服务对外暴露时建议设置 `TRPG_PASSWORD`,否则任何人都能访问并消耗你的 LLM 配额
- 默认端口 3000,可用 `PORT` 环境变量覆盖
- 默认 BGM/SFX 文件较大(`public/audio/` ~80MB),如果带宽紧张可考虑用 CDN 或剥离

## 许可

代码:见仓库根目录。
音频/美术资源:见 [`public/audio/CREDITS.md`](public/audio/CREDITS.md),
混合 CC0 / CC-BY,部分资源需要署名(已在 CREDITS.md 标明)。
