#!/bin/bash
# x402 API 完整自动化管道
# 每日运行：发现机会 → 评估 → 通知开发 → 监控健康 → 统计收益

set -e

SCRIPTS_DIR="$(dirname "$0")"
DATA_DIR="$SCRIPTS_DIR/../data"
TODAY=$(date +%Y-%m-%d)
API_URL="https://api.aitoollab.top"
WALLET="0x1D99D952eAd3E8907c9989D15303d3Bcc443Ef97"

mkdir -p "$DATA_DIR"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║        x402 API Automation Pipeline - $TODAY         ║"
echo "╚══════════════════════════════════════════════════════════╝"

# ═══════════════════════════════════════════════════════════════
# 1. 扫描 x402 生态
# ═══════════════════════════════════════════════════════════════
echo -e "\n[1/5] 🔍 Scanning x402 ecosystem..."
node "$SCRIPTS_DIR/discovery.js" 2>&1 | tail -10

# ═══════════════════════════════════════════════════════════════
# 2. 评估机会
# ═══════════════════════════════════════════════════════════════
echo -e "\n[2/5] 📊 Assessing opportunities..."
node "$SCRIPTS_DIR/opportunity-assessment.js" 2>&1 | tail -15

# ═══════════════════════════════════════════════════════════════
# 3. 检查开发队列，生成通知
# ═══════════════════════════════════════════════════════════════
echo -e "\n[3/5] 📝 Checking development queue..."
QUEUE_FILE="$DATA_DIR/opportunity-queue.json"

if [ -f "$QUEUE_FILE" ]; then
  QUEUE_COUNT=$(jq '.developmentQueue | length' "$QUEUE_FILE" 2>/dev/null || echo "0")
  echo "  Opportunities in queue: $QUEUE_COUNT"
  
  if [ "$QUEUE_COUNT" -gt 0 ]; then
    # 生成通知文件（Agent 下次运行时会检查）
    NOTIFY_FILE="$DATA_DIR/pending-development.txt"
    jq -r '.developmentQueue[] | "\(.rank). \(.category) (Score: \(.score)) - $\(.suggestedPrice)"' "$QUEUE_FILE" > "$NOTIFY_FILE"
    echo "  ⚠️  New opportunities pending development!"
    echo "  See: $NOTIFY_FILE"
    cat "$NOTIFY_FILE"
  fi
else
  echo "  No queue file found"
fi

# ═══════════════════════════════════════════════════════════════
# 4. 监控端点健康
# ═══════════════════════════════════════════════════════════════
echo -e "\n[4/5] 🏥 Checking endpoint health..."

# 获取端点列表
ENDPOINTS=$(curl -s "$API_URL/.well-known/x402" | jq -r '.resources | length' 2>/dev/null || echo "0")
echo "  Total endpoints: $ENDPOINTS"

# 抽查关键端点
HEALTHY=0
FAILED=0
for endpoint in "/api/crypto/price/btc" "/api/defi/yields" "/api/agent/score/0x1D99D952eAd3E8907c9989D15303d3Bcc443Ef97"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL$endpoint" 2>/dev/null || echo "000")
  if [ "$CODE" = "402" ]; then
    HEALTHY=$((HEALTHY + 1))
    echo "  ✅ $endpoint: $CODE"
  else
    FAILED=$((FAILED + 1))
    echo "  ❌ $endpoint: $CODE"
  fi
done

echo "  Healthy: $HEALTHY, Failed: $FAILED"

# ═══════════════════════════════════════════════════════════════
# 5. 统计收益（从链上数据）
# ═══════════════════════════════════════════════════════════════
echo -e "\n[5/5] 💰 Revenue tracking..."
echo "  Wallet: $WALLET"
echo "  Network: Base (eip155:8453)"
echo "  To check: https://basescan.org/address/$WALLET"

# ═══════════════════════════════════════════════════════════════
# 生成每日报告
# ═══════════════════════════════════════════════════════════════
REPORT="$DATA_DIR/daily-pipeline-$TODAY.json"
cat > "$REPORT" << EOF
{
  "date": "$TODAY",
  "timestamp": "$(date -Iseconds)",
  "pipeline": {
    "discovery": "completed",
    "assessment": "completed",
    "queue_size": $QUEUE_COUNT
  },
  "health": {
    "endpoints": $ENDPOINTS,
    "healthy": $HEALTHY,
    "failed": $FAILED
  },
  "wallet": "$WALLET"
}
EOF

echo -e "\n╔══════════════════════════════════════════════════════════╗"
echo "║                   Pipeline Complete ✅                    ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo "Report: $REPORT"
