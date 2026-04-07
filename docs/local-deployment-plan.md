# TRPG Agent 本地部署方案（$100K 预算）

## 一、当前架构分析

你的项目是一个成熟的 TRPG 引擎，核心架构特点：

- **双 Agent 设计**：DM Agent（叙事）+ Rules Agent（意图分类）
- **确定性 + 叙事分离**：战斗/规则由代码处理，描述/对话由 LLM 生成
- **当前模型**：Kimi K2.5 via OpenAI-compatible endpoint
- **13 个工具调用**：骰子、移动、对话、攻击等
- **实时流式传输**：WebSocket + async generator
- **上下文需求**：游戏事实注入 + NPC 关系 + 章节状态，单次 prompt 约 8-15K tokens

**迁移到本地的关键需求**：

| 需求 | 说明 |
|------|------|
| 工具调用能力 | 13 个 tool，需要模型稳定的 function calling |
| 流式输出 | 已有 async generator，需要推理引擎支持 SSE/streaming |
| 中文创意写作 | DM 叙事、NPC 对话质量是核心体验 |
| 推理速度 | TRPG 是交互式的，首 token 延迟 < 500ms，生成速度 > 20 tokens/s |
| 并发支持 | 预计 3-8 个同时在线的游戏会话 |
| 长上下文 | 单次 prompt 8-15K，累积游戏状态可达 32-64K |

---

## 二、模型选型

### 推荐主力模型：Qwen3-30B-A3B（MoE）

| 指标 | 数值 |
|------|------|
| 总参数 | 30.5B |
| 激活参数 | 3.3B（仅占 ~11%）|
| 原生上下文 | 256K tokens |
| 许可证 | Apache 2.0 |
| 思考模式 | 支持开关切换 |
| 工具调用 | 原生支持，首次正确率 ~87% |

**为什么选它而不是 Qwen3-32B 密集模型？**

- 推理速度快 2-3 倍（只激活 3.3B 参数）
- 显存占用低得多（Q4 量化仅需 ~17GB vs 密集模型的 ~19-65GB）
- 性能接近 QwQ-32B（后者激活参数是它的 10 倍）
- TRPG 场景不需要密集模型的极限推理能力，MoE 的创意 + 工具调用已经足够

### 备选模型

| 模型 | 用途 | 备注 |
|------|------|------|
| Qwen3-Coder-30B-A3B | Rules Agent（意图分类） | 工具调用更强，适合做分类器 |
| Qwen3-8B / Qwen3-4B | Rules Agent 轻量版 | 意图分类不需要大模型，regex + 小模型双层够用 |
| Gemma 3 27B | 备用 DM 模型 | 中文能力稍弱但创意写作强 |
| Qwen3-32B Dense | 高难度场景 | 需要更强推理时切换 |

### 推荐部署配置

```
DM Agent     → Qwen3-30B-A3B（主力，处理叙事+工具调用）
Rules Agent  → Qwen3-4B 或 Qwen3-8B（意图分类，极快响应）
备用 DM      → Qwen3-32B Dense（困难 boss 战/复杂剧情分支时切换）
```

---

## 三、硬件方案对比

### 方案 A：多卡消费级集群（推荐 ⭐）

**配置：6× RTX 4090 + 1× RTX 5090**

| 组件 | 数量 | 单价 | 总价 |
|------|------|------|------|
| RTX 4090 24GB | 6 | $2,500 | $15,000 |
| RTX 5090 32GB | 1 | $3,500 | $3,500 |
| 服务器主板（支持 4 GPU） | 2 | $1,500 | $3,000 |
| AMD EPYC 9354 / Threadripper | 2 | $2,500 | $5,000 |
| 256GB DDR5 ECC（每台） | 2 | $1,200 | $2,400 |
| 2000W 白金 PSU | 2 | $500 | $1,000 |
| 4TB NVMe SSD（每台） | 2 | $400 | $800 |
| 服务器机箱 + 散热 | 2 | $800 | $1,600 |
| 10GbE 网络交换机 + 线缆 | 1 | $1,500 | $1,500 |
| UPS 不间断电源 | 1 | $2,000 | $2,000 |
| **硬件小计** | | | **$35,800** |
| 预留升级/维护 | | | $14,200 |
| **总计** | | | **$50,000** |

**预算剩余 $50,000 用途**：

- $20,000 → 未来升级到 RTX 5090 或下一代 GPU
- $15,000 → 运营成本（电费、网络、维护，约 2-3 年）
- $15,000 → 开发人力/模型微调数据集

**性能预估**：

| 场景 | 硬件分配 | 性能 |
|------|----------|------|
| 单会话 DM（Qwen3-30B-A3B Q4） | 1× RTX 4090 | ~35-50 tokens/s |
| 单会话 DM（Qwen3-32B Dense Q4） | 2× RTX 4090 | ~20-30 tokens/s |
| Rules Agent（Qwen3-4B） | 1× RTX 4090 共享 | ~100+ tokens/s |
| 5 并发会话 | 4× RTX 4090 | 每会话 ~20-30 tokens/s |
| 8 并发会话 | 6× RTX 4090 + 1× RTX 5090 | 每会话 ~15-25 tokens/s |

**优势**：性价比最高，维护简单，社区支持好，升级灵活
**劣势**：单卡显存 24GB 限制密集模型的上下文长度

---

### 方案 B：企业级单卡方案

**配置：2× H200 141GB**

| 组件 | 数量 | 单价 | 总价 |
|------|------|------|------|
| NVIDIA H200 SXM 141GB | 2 | $32,000 | $64,000 |
| 服务器底座（支持 SXM） | 1 | $15,000 | $15,000 |
| 机房托管费（年） | 1 | $6,000 | $6,000 |
| 网络/存储/UPS | 1 | $5,000 | $5,000 |
| **总计** | | | **$90,000** |

**性能预估**：

| 场景 | 性能 |
|------|------|
| Qwen3-30B-A3B FP16 | ~100+ tokens/s |
| Qwen3-32B Dense FP16 | ~60-80 tokens/s |
| 10 并发会话（MoE） | 每会话 ~30-40 tokens/s |
| 256K 上下文 | 完整支持，无需量化 |

**优势**：141GB 显存无需量化，原生支持超长上下文，单机性能极强
**劣势**：预算紧张，需要专业机房环境，维护成本高

---

### 方案 C：Mac Studio 集群（静音/低功耗）

**配置：4× Mac Studio M4 Ultra 256GB**

| 组件 | 数量 | 单价 | 总价 |
|------|------|------|------|
| Mac Studio M4 Ultra 256GB | 4 | $10,000 | $40,000 |
| 10GbE 网络设备 | 1 | $2,000 | $2,000 |
| **总计** | | | **$42,000** |

**性能预估**：

| 场景 | 性能 |
|------|------|
| Qwen3-30B-A3B（单机 MLX） | ~50-78 tokens/s |
| Qwen3-32B Dense（单机 MLX） | ~30-40 tokens/s |
| 4 并发会话（每台 1 个） | 每会话 ~50 tokens/s |

**优势**：静音，低功耗（每台 ~150W），256GB 统一内存装任何模型，无需专业机房
**劣势**：GPU 计算力不如 NVIDIA，多节点推理框架不成熟，MLX 生态较小

---

### 方案 D：混合方案（最灵活）

**配置：2× Mac Studio M4 Ultra + 4× RTX 4090**

| 组件 | 单价 | 总价 |
|------|------|------|
| Mac Studio M4 Ultra 256GB × 2 | $10,000 | $20,000 |
| RTX 4090 服务器（4 卡） | - | $20,000 |
| 网络设备 + UPS | - | $5,000 |
| **总计** | | **$45,000** |

**角色分工**：
- Mac Studio → 运行密集大模型（Qwen3-32B/70B），利用 256GB 统一内存
- RTX 4090 集群 → 高并发 MoE 推理（Qwen3-30B-A3B），利用 CUDA 加速

---

## 四、推荐方案：方案 A（消费级多卡）+ 精简版方案 C

**最终推荐配置**（$65,000 硬件 + $35,000 预留）：

```
┌─────────────────────────────────────────────────┐
│  推理集群 Node 1: NVIDIA GPU Server              │
│  ├─ 4× RTX 4090 (96GB total VRAM)               │
│  ├─ AMD EPYC 9354 / TR 7960X                    │
│  ├─ 256GB DDR5 ECC                               │
│  ├─ 2× 2TB NVMe                                  │
│  ├─ 2000W Platinum PSU                           │
│  └─ 角色: 主力并发推理 (vLLM)                      │
│     ├─ DM Agent × 4 会话 (Qwen3-30B-A3B)         │
│     └─ Rules Agent (Qwen3-4B, 共享 1 卡)          │
├─────────────────────────────────────────────────┤
│  推理节点 Node 2: Mac Studio M4 Ultra × 2        │
│  ├─ 256GB 统一内存 × 2                            │
│  ├─ 角色: 密集模型 / 溢出处理                      │
│     ├─ Qwen3-32B Dense (高难度场景)               │
│     ├─ 未来 70B+ 模型实验                          │
│     └─ 备用 DM 会话                               │
├─────────────────────────────────────────────────┤
│  网关层: 游戏服务器 (可复用 Mac 或单独 Node)        │
│  ├─ Express.js + WebSocket (你现有的 server.ts)   │
│  ├─ 负载均衡 / 会话路由                            │
│  └─ 模型热切换逻辑                                 │
└─────────────────────────────────────────────────┘
```

| 组件 | 价格 |
|------|------|
| 4× RTX 4090 服务器 | $20,000 |
| 2× Mac Studio M4 Ultra 256GB | $20,000 |
| 网络/UPS/存储 | $5,000 |
| **硬件小计** | **$45,000** |
| 微调数据 + 工具 | $10,000 |
| 2 年运营成本 | $10,000 |
| 升级预留 | $35,000 |
| **总计** | **$100,000** |

---

## 五、推理引擎与服务架构

### 推理层选型

| 节点 | 推理引擎 | 理由 |
|------|----------|------|
| RTX 4090 集群 | **vLLM** | 成熟的 continuous batching，OpenAI 兼容 API，KV cache 量化 |
| Mac Studio | **MLX + mlx-lm** | Apple Silicon 原生优化，统一内存零拷贝 |
| 备选 | **SGLang** | 多轮对话优化，RadixAttention 缓存前缀 |

### 服务架构

```
                    ┌──────────────────┐
                    │  玩家客户端       │
                    │  (Web/CLI)       │
                    └────────┬─────────┘
                             │ WebSocket
                             ▼
                    ┌──────────────────┐
                    │  游戏网关         │
                    │  (Express.js)    │
                    │  session router  │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
     ┌────────────┐ ┌────────────┐ ┌────────────┐
     │  vLLM #1   │ │  vLLM #2   │ │  MLX #1    │
     │  GPU 0,1   │ │  GPU 2,3   │ │  Mac Ultra │
     │  DM×2会话  │ │  DM×2会话  │ │  Dense/备用 │
     └────────────┘ └────────────┘ └────────────┘
           │              │              │
           └──────────────┴──────────────┘
                          │
                    OpenAI Compatible API
                    (统一 /v1/chat/completions)
```

### 你的代码改动量极小

你的 `dm-agent.ts` 已经是 OpenAI 兼容 API 调用，迁移到本地只需改环境变量：

```bash
# 从云端 API
TRPG_BASE_URL=https://your-llm-endpoint/v1
TRPG_MODEL=moonshotai/Kimi-K2.5

# 改为本地 vLLM
TRPG_BASE_URL=http://localhost:8000/v1
TRPG_MODEL=Qwen/Qwen3-30B-A3B

# 或本地 MLX
TRPG_BASE_URL=http://mac-studio-1.local:8080/v1
TRPG_MODEL=mlx-community/Qwen3-32B-4bit
```

**不需要改任何代码**，因为你的 `open-claude-cli` SDK 已经是 OpenAI 兼容的。

---

## 六、网络通信方案

### 局域网架构

```
┌──────────────────────────────────────────┐
│  10GbE 交换机 (Mikrotik CRS310 ~$300)   │
│                                          │
│  ├── GPU Server (10GbE)                  │
│  │   └── vLLM :8000, :8001              │
│  ├── Mac Studio #1 (10GbE)              │
│  │   └── MLX Server :8080               │
│  ├── Mac Studio #2 (10GbE)              │
│  │   └── MLX Server :8080               │
│  └── Game Gateway (10GbE or 1GbE)       │
│      └── Express.js :10000              │
│          ├── WebSocket (玩家连接)         │
│          └── 反向代理到推理节点            │
└──────────────────────────────────────────┘
```

### 外网访问方案

| 方案 | 延迟 | 成本 | 适用场景 |
|------|------|------|----------|
| **Tailscale/ZeroTier** | +5-20ms | 免费 | 朋友间小范围游戏 |
| **Cloudflare Tunnel** | +10-30ms | 免费 | 公开访问，自动 HTTPS |
| **FRP 内网穿透** | +10-50ms | 需要 VPS（$5/月）| 国内访问优化 |
| **专线 / 固定 IP** | +2-5ms | $50-200/月 | 正式运营 |

**推荐**：开发阶段用 Tailscale（零配置 VPN），上线用 Cloudflare Tunnel + 自定义域名。

### 会话路由策略

在 `server.ts` 中增加负载均衡逻辑：

```typescript
// 新增: 推理节点池
const inferencePool = [
  { url: 'http://gpu-server:8000/v1', model: 'Qwen3-30B-A3B', type: 'moe', maxSessions: 4 },
  { url: 'http://gpu-server:8001/v1', model: 'Qwen3-4B', type: 'rules', maxSessions: 20 },
  { url: 'http://mac-1.local:8080/v1', model: 'Qwen3-32B', type: 'dense', maxSessions: 2 },
  { url: 'http://mac-2.local:8080/v1', model: 'Qwen3-32B', type: 'dense', maxSessions: 2 },
];

// 会话创建时分配节点
function assignInferenceNode(sessionType: 'dm' | 'rules' | 'boss'): InferenceNode {
  if (sessionType === 'rules') return pool.find(n => n.type === 'rules');
  if (sessionType === 'boss') return pool.find(n => n.type === 'dense' && n.currentSessions < n.maxSessions);
  return pool.find(n => n.type === 'moe' && n.currentSessions < n.maxSessions);
}
```

---

## 七、API 调用优化

### 1. KV Cache 前缀缓存

你的 DM Agent 每次调用都发送完整的 system prompt（100+ 行）+ 游戏事实。vLLM 和 SGLang 都支持**自动前缀缓存**：

```bash
# vLLM 启动时启用
vllm serve Qwen/Qwen3-30B-A3B \
  --enable-prefix-caching \
  --max-model-len 65536 \
  --gpu-memory-utilization 0.90 \
  --kv-cache-dtype fp8
```

效果：重复的 system prompt 部分只计算一次，后续请求直接复用 KV cache，**首 token 延迟降低 40-60%**。

### 2. Rules Agent 优化

你的 `rules-agent.ts` 已经有 regex 快速路径，可以进一步优化：

```
玩家输入 → Regex 匹配（0ms）
         → 命中 → 直接返回分类
         → 未命中 → Qwen3-4B（~50ms，本地极快）
```

用 4B 模型替代 K2.5 做意图分类，延迟从 ~500ms 降到 ~50ms。

### 3. 推测解码（Speculative Decoding）

```bash
# vLLM 支持 draft model 加速
vllm serve Qwen/Qwen3-30B-A3B \
  --speculative-model Qwen/Qwen3-0.6B \
  --num-speculative-tokens 5
```

用 0.6B 小模型预测 token，大模型验证，生成速度提升 1.5-2 倍。

### 4. 流式输出优化

你的 WebSocket 已经支持流式，本地部署后延迟链路：

```
云端: 玩家 → 你的服务器 → 远端 LLM API → Kimi K2.5 → 返回
     总延迟: 200-800ms 首 token + 网络抖动

本地: 玩家 → 你的服务器 → localhost vLLM → 返回
     总延迟: 50-150ms 首 token，极其稳定
```

---

## 八、模型微调方向（可选）

用 $10,000 预留预算做针对性微调：

| 方向 | 数据来源 | 预期效果 |
|------|----------|----------|
| DM 叙事风格 | 收集优秀 TRPG 实况/小说片段 | 叙事更有文学性和氛围感 |
| 工具调用准确性 | 你的 13 个工具的调用日志 | 工具选择准确率 87% → 95%+ |
| NPC 性格一致性 | 角色卡 + 示例对话 | 减少角色 "串戏" |
| 中文战斗描写 | 武侠/奇幻小说战斗段落 | 战斗叙事更生动 |

微调工具推荐：LLaMA-Factory（支持 LoRA/QLoRA），4× RTX 4090 可以高效微调 30B 模型。

---

## 九、分阶段实施路线

### Phase 1: 快速验证（$5,000，2 周）

- 买 1 台 Mac Studio M4 Ultra 256GB 或 1 张 RTX 4090
- 用 Ollama/vLLM 部署 Qwen3-30B-A3B
- 改环境变量指向本地，跑通完整游戏流程
- 评估：叙事质量、工具调用稳定性、响应速度

### Phase 2: 生产部署（$40,000，1 个月）

- 搭建 4× RTX 4090 服务器
- 部署 vLLM + prefix caching + speculative decoding
- 实现会话路由和负载均衡
- 压力测试 5-8 并发会话

### Phase 3: 扩展优化（$20,000，2-3 个月）

- 增加 Mac Studio 节点处理密集模型
- 收集游戏日志，启动模型微调
- 优化 KV cache 管理，支持更长游戏会话
- 实现模型热切换（普通场景 MoE，boss 战 Dense）

### Phase 4: 预留升级（$35,000，长期）

- 跟踪下一代 GPU（RTX 6090 / B200 降价）
- 评估 Qwen4 / Gemma 5 等新一代模型
- 根据用户规模决定是否扩容

---

## 十、风险与应对

| 风险 | 概率 | 应对 |
|------|------|------|
| Qwen3-30B 工具调用不稳定 | 中 | 保留 Kimi K2.5 API 作为 fallback，逐步迁移 |
| RTX 4090 停产涨价 | 高 | 现在囤货 or 转向 RTX 5090 |
| 长上下文性能衰减 | 中 | 实现滑动窗口 + 事实摘要压缩 |
| 多卡并行推理不稳定 | 低 | MoE 模型单卡即可运行，不依赖张量并行 |
| 电力/散热问题 | 低 | 消费级 GPU 方案功耗可控（~2kW），家用空调足够 |
