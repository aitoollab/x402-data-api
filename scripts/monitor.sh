#!/bin/bash
# x402 API 完整自动化管道 v2
# 发现机会 → 评估 → 自动生成代码 → 部署 → 监控

set -e

SCRIPTS_DIR="$(dirname "$0")"
DATA_DIR="$SCRIPTS_DIR/../data"
TODAY=$(date +%Y-%m-%d)
API_URL="https://api.aitoollab.top"

mkdir -p "$DATA_DIR"

echo "╔════════════════════════════════════════════════════════════╗"
echo "║       x402 API Automation Pipeline v2 - $TODAY        ║"
echo "╚════════════════════════════════════════════════════════════╝"

# ═══════════════════════════════════════════════════════════════
# 1. 扫描 x402 生态机会
# ═══════════════════════════════════════════════════════════════
echo -e "\n[1/5] 🔍 Scanning x402 ecosystem..."
node "$SCRIPTS_DIR/discovery.js" 2>&1 | tail -10

# ═══════════════════════════════════════════════════════════════
# 2. 评估机会，生成队列
# ═══════════════════════════════════════════════════════════════
echo -e "\n[2/5] 📊 Assessing opportunities..."
node "$SCRIPTS_DIR/opportunity-assessment.js" 2>&1 | tail -15

# ═══════════════════════════════════════════════════════════════
# 3. 自动生成端点代码
# ═══════════════════════════════════════════════════════════════
echo -e "\n[3/5] 🔧 Generating endpoints..."
node "$SCRIPTS_DIR/generate-endpoint.js" 2>&1

# 检查是否有新生成的端点
GENERATED_FILE="$DATA_DIR/generated-endpoints.json"
if [ -f "$GENERATED_FILE" ]; then
  NEW_ENDPOINTS=$(jq '.generated' "$GENERATED_FILE" 2>/dev/null || echo "0")
  if [ "$NEW_ENDPOINTS" -gt 0 ]; then
    echo "  ⚠️  $NEW_ENDPOINTS new endpoints generated!"
    echo "  See: $DATA_DIR/generated/"
    cat "$GENERATED_FILE" | jq '.endpoints[] | "  - \(.route) ($\(.price))"'
  fi
fi

# ═══════════════════════════════════════════════════════════════
# 4. 监控现有端点健康
# ═══════════════════════════════════════════════════════════════
echo -e "\n[4/5] 🏥 Monitoring endpoints..."

# 获取端点列表
ENDPOINTS=$(curl -s "$API_URL/.well-known/x402" | jq -r '.resources | length' 2>/dev/null || echo "0")
echo "  Total endpoints: $ENDPOINTS"

# 抽查关键端点
HEALTHY=0
FAILED=0
for endpoint in "/api/crypto/price/btc" "/api/defi/yields" "/api/agent/score/0x1D99D952eAd3E8907c9989D15303d3Bcc443Ef97" "/api/whale/transactions"; do
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
# 5. 生成汇总报告
# ═══════════════════════════════════════════════════════════════
echo -e "\n[5/5] 📝 Generating report..."

REPORT="$DATA_DIR/daily-pipeline-$TODAY.json"
cat > "$REPORT" << EOF
{
  "date": "$TODAY",
  "timestamp": "$(date -Iseconds)",
  "pipeline": {
    "discovery": "completed",
    "assessment": "completed",
    "generation": "completed",
    "new_endpoints": $NEW_ENDPOINTS
  },
  "health": {
    "endpoints": $ENDPOINTS,
    "healthy": $HEALTHY,
    "failed": $FAILED
  }
}
EOF

echo -e "\n╔════════════════════════════════════════════════════════════╗"
echo "║                  Pipeline Complete ✅                      ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo "Report: $REPORT"

# 如果有新生成的端点，提示下一步
if [ "$NEW_ENDPOINTS" -gt 0 ]; then
  echo -e "\n⚠️  ACTION REQUIRED:"
  echo "New endpoints generated in: $DATA_DIR/generated/"
  echo "Review and merge into index.js, then push to deploy."
fi
