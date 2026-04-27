#!/bin/bash
# x402 API 完整自动化管道 v3
# 发现机会 → 评估 → 生成代码 → 自动审查 → 自动提交

set -e

SCRIPTS_DIR="$(dirname "$0")"
DATA_DIR="$SCRIPTS_DIR/../data"
TODAY=$(date +%Y-%m-%d)
API_URL="https://api.aitoollab.top"

mkdir -p "$DATA_DIR"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║       x402 API Automation Pipeline v3 - $TODAY          ║"
echo "╚══════════════════════════════════════════════════════════════╝"

# ═══════════════════════════════════════════════════════════════════
# 1. 扫描 x402 生态机会
# ═══════════════════════════════════════════════════════════════════
echo -e "\n[1/6] 🔍 Scanning x402 ecosystem..."
node "$SCRIPTS_DIR/discovery.js" 2>&1 | tail -10

# ═══════════════════════════════════════════════════════════════════
# 2. 评估机会，生成队列
# ═══════════════════════════════════════════════════════════════════
echo -e "\n[2/6] 📊 Assessing opportunities..."
node "$SCRIPTS_DIR/opportunity-assessment.js" 2>&1 | tail -15

# ═══════════════════════════════════════════════════════════════════
# 3. 自动生成端点代码
# ═══════════════════════════════════════════════════════════════════
echo -e "\n[3/6] 🔧 Generating endpoints..."
GENERATE_RESULT=$(node "$SCRIPTS_DIR/generate-endpoint.js" 2>&1)
echo "$GENERATE_RESULT" | tail -20

# 检查是否生成成功
if echo "$GENERATE_RESULT" | grep -q "All generated endpoints passed review"; then
  REVIEW_PASSED=true
else
  REVIEW_PASSED=false
fi

# ═══════════════════════════════════════════════════════════════════
# 4. 自动审查（已内嵌在 generate-endpoint.js 中）
# ═══════════════════════════════════════════════════════════════════
echo -e "\n[4/6] 📋 Review status: $([ "$REVIEW_PASSED" = true ] && echo "✅ PASSED" || echo "❌ FAILED")"

# ═══════════════════════════════════════════════════════════════════
# 5. 如果审查通过，自动提交
# ═══════════════════════════════════════════════════════════════════
if [ "$REVIEW_PASSED" = true ]; then
  echo -e "\n[5/6] 🚀 Auto-committing..."
  
  # 检查是否有新生成的端点
  NEW_COUNT=$(jq '.results | length' "$DATA_DIR/review-report.json" 2>/dev/null || echo "0")
  
  if [ "$NEW_COUNT" -gt 0 ]; then
    bash "$SCRIPTS_DIR/auto-commit.sh" 2>&1 | tail -15
    echo "  ✅ Committed and pushed $NEW_COUNT endpoint(s)"
  else
    echo "  No new endpoints to commit."
  fi
else
  echo -e "\n[5/6] ⏸️  Skipping commit (review failed)"
fi

# ═══════════════════════════════════════════════════════════════════
# 6. 监控现有端点健康
# ═══════════════════════════════════════════════════════════════════
echo -e "\n[6/6] 🏥 Monitoring endpoints..."

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

# ═══════════════════════════════════════════════════════════════════
# 生成报告
# ═══════════════════════════════════════════════════════════════════
REPORT="$DATA_DIR/pipeline-report-$TODAY.json"
cat > "$REPORT" << EOF
{
  "date": "$TODAY",
  "timestamp": "$(date -Iseconds)",
  "pipeline": {
    "discovery": "completed",
    "assessment": "completed",
    "generation": "completed",
    "review_passed": $REVIEW_PASSED,
    "committed": $REVIEW_PASSED
  },
  "health": {
    "endpoints": $ENDPOINTS,
    "healthy": $HEALTHY,
    "failed": $FAILED
  }
}
EOF

echo -e "\n╔══════════════════════════════════════════════════════════════════╗"
echo "║                    Pipeline Complete ✅                          ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo "Report: $REPORT"

if [ "$REVIEW_PASSED" = true ] && [ "$NEW_COUNT" -gt 0 ]; then
  echo -e "\n🎉 New endpoints deployed! Server will update at scheduled time."
fi
