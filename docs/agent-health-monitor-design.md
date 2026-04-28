# Agent Health Monitor - x402 端点设计方案

> 最后更新：2026-04-28

---

## 核心定位

**给链上 AI Agent 用的"体检报告"**——Agent 可以每天或每次交易前调用，检查自己的健康状态、Gas 效率、风险暴露。

---

## 端点矩阵

### 核心端点（6个）

| 端点 | 功能 | 价格 | 数据源 |
|------|------|------|--------|
| `GET /api/agent/health/{address}` | 综合健康评分 (0-100) | $0.03 | Etherscan + 链上 |
| `GET /api/agent/gas/{address}` | Gas 优化建议 | $0.02 | Etherscan 历史 |
| `GET /api/agent/wash-trade/{address}` | 清洗交易检测报告 | $0.05 | 链上模式识别 |
| `GET /api/agent/risk/{address}` | 风险暴露分析 | $0.03 | 多维度评分 |
| `GET /api/agent/behavior/{address}` | 行为模式分类 | $0.02 | Etherscan 活动 |
| `GET /api/agent/full-report/{address}` | 综合报告（以上全部） | $0.10 | 聚合 |

### 附加端点（4个）

| 端点 | 功能 | 价格 |
|------|------|------|
| `GET /api/agent/score/{address}` | 单值信任分 (0-1000) | $0.02 |
| `GET /api/agent/history/{address}` | 30天活动历史 | $0.02 |
| `GET /api/agent/peers/{address}` | 相似行为 Agent 列表 | $0.03 |
| `GET /api/agent/alerts/{address}` | 实时风险预警 | $0.02 |

---

## 端点详情

### 1. `/api/agent/health/{address}`

**功能**：返回 Agent 地址的综合健康评分

**响应示例**：
```json
{
  "address": "0x1234...",
  "health_score": 78,
  "grade": "B",
  "factors": {
    "uptime": 95,
    "gas_efficiency": 72,
    "risk_exposure": 65,
    "transaction_success_rate": 89
  },
  "recommendations": [
    "Gas 效率低于平均水平，建议优化交易时机",
    "近期有 2 笔高风险交互，建议检查"
  ],
  "last_updated": "2026-04-28T10:00:00Z"
}
```

**评分逻辑**：
- 上线时间 / 交易频率
- 平均 Gas 费用 vs 网络平均
- 交互协议数量 / 风险协议暴露
- 失败交易比例

---

### 2. `/api/agent/gas/{address}`

**功能**：分析历史 Gas 使用，给出优化建议

**响应示例**：
```json
{
  "address": "0x1234...",
  "avg_gas_used": 145000,
  "network_avg": 120000,
  "efficiency_ratio": 0.83,
  "suggestions": [
    {
      "type": "timing",
      "saving_estimate": "15-25%",
      "description": "在周末 18:00-22:00 UTC 交易，Gas 平均低 20%"
    },
    {
      "type": " batching",
      "saving_estimate": "30-40%",
      "description": "建议合并 3 笔小交易为 1 笔批处理"
    },
    {
      "type": "priority",
      "saving_estimate": "5-10%",
      "description": "非紧急交易使用 EIP-1559 低优先级"
    }
  ],
  "best_window": {
    "day": "Sunday",
    "hour_start": 18,
    "hour_end": 22,
    "avg_gas": 95000
  }
}
```

---

### 3. `/api/agent/wash-trade/{address}`

**功能**：检测是否有清洗交易（非真实交易量）

**响应示例**：
```json
{
  "address": "0x1234...",
  "wash_trade_score": 12,
  "verdict": "LOW_RISK",
  "flags": [
    {
      "type": "circular_transfer",
      "severity": "warning",
      "description": "检测到与 0x5678... 的循环转账模式"
    }
  ],
  "volume_legitimacy": 88,
  "network_ranks": {
    "volume_percentile": 65,
    "frequency_percentile": 72
  }
}
```

**检测方法**：
- 短时间内同金额双向转账
- 与已知机器人地址的关联
- 交易时间模式分析

---

### 4. `/api/agent/risk/{address}`

**功能**：Agent 风险暴露分析

**响应示例**：
```json
{
  "address": "0x1234...",
  "risk_score": 35,
  "level": "MEDIUM",
  "exposures": [
    {
      "protocol": "Uniswap V3",
      "risk_type": "impermanent_loss",
      "exposure_percent": 15,
      "recommendation": "减少流动性头寸"
    },
    {
      "protocol": "Aave V3",
      "risk_type": "liquidation",
      "exposure_percent": 8,
      "recommendation": "健康因子偏低，建议补充抵押"
    }
  ],
  "threats": [
    {
      "type": "sandwich_attack",
      "probability": 22,
      "estimated_loss": "0.001-0.005 ETH"
    }
  ]
}
```

---

### 5. `/api/agent/behavior/{address}`

**功能**：行为模式分类

**响应示例**：
```json
{
  "address": "0x1234...",
  "primary_behavior": "liquidity_provider",
  "secondary_behavior": "defi_trader",
  "confidence": 87,
  "characteristics": {
    "avg_hold_time": "14 days",
    "typical_trade_size": "2.5 ETH",
    "preferred_protocols": ["Uniswap", "Curve", "Aave"],
    "trading_frequency": "daily",
    "risk_profile": "medium"
  },
  "similar_agents": 145
}
```

**分类类型**：
- 流动性提供者 (LP)
- DeFi 交易者
- NFT 炒家
- 套利机器人
- 巨鲸积累者
- 普通用户

---

### 6. `/api/agent/full-report/{address}`

**功能**：以上 5 个端点的聚合报告，一次调用返回全部

**价格**：$0.10（相当于打包优惠，单独调用需 $0.15）

**响应**：包含以上所有数据结构的超集

---

## 数据源

| 数据 | 来源 | 成本 |
|------|------|------|
| 链上交易历史 | Etherscan API | $0/天（免费 tier）|
| Gas 价格 | Etherscan gas tracker | 免费 |
| 协议交互 | Etherscan + DeBank API | 免费 |
| 风险评分 | 自研算法 | 无额外成本 |

---

## 技术实现

### 缓存策略

| 端点 | 缓存时间 | 原因 |
|------|---------|------|
| `/health` | 1 小时 | 评分变化慢 |
| `/gas` | 15 分钟 | Gas 价格波动大 |
| `/wash-trade` | 6 小时 | 模式变化慢 |
| `/risk` | 1 小时 | 风险暴露变化慢 |
| `/behavior` | 24 小时 | 分类稳定 |

### 错误处理

- 地址无效：返回 400
- 地址无数据（新建地址）：返回评分 50 + 标注"新地址"
- 数据源超时：返回缓存数据 + `stale: true`

---

## 差异化价值

1. **专门为 Agent 设计**：不是给人类看的，是给 AI Agent 调用的
2. **可执行建议**：不只是分数，还有具体的优化建议
3. **多维度聚合**：一次调用 = 全方位体检
4. **定价合理**：$0.02-0.10，每次调用成本极低

---

## 扩展计划

### Phase 2
- 实时预警 Webhook（订阅模式）
- 历史趋势分析（7天/30天）
- 与其他 Agent 的对比报告

### Phase 3
- 跨链健康监控（Base + Solana + Arbitrum）
- 自动化修复建议执行
- Agent 声誉 NFT

---

## 预计收益

基于 x402 生态 Agent 数量增长：

| 月 | Agent 数量假设 | 日均调用/Agent | 月收益估算 |
|----|--------------|---------------|-----------|
| 1 | 100 | 5 | $450 |
| 3 | 500 | 8 | $3,600 |
| 6 | 2000 | 10 | $18,000 |
| 12 | 10000 | 12 | $108,000 |

---

## 实施优先级

1. `/api/agent/health/{address}` - 先做这个，核心指标
2. `/api/agent/gas/{address}` - 数据容易获取
3. `/api/agent/behavior/{address}` - 已有类似端点，扩展
4. `/api/agent/wash-trade/{address}` - 需要更多模式数据
5. `/api/agent/risk/{address}` - 最复杂，最后做
