#!/bin/bash
# x402 API 机会发现管道
# 扫描生态 → 评估机会 → 生成代码 → 审查 → 提交

set -e

SCRIPTS_DIR="$(dirname "$0")"
DATA_DIR="$SCRIPTS_DIR/../data"
TODAY=$(date +%Y-%m-%d)

mkdir -p "$DATA_DIR"
mkdir -p "$DATA_DIR/generated"

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║         x402 Opportunity Pipeline - $TODAY                    ║"
echo "╚══════════════════════════════════════════════════════════════════╝"

# ═══════════════════════════════════════════════════════════════════
# 1. 扫描 x402 生态机会
# ═══════════════════════════════════════════════════════════════════
echo -e "\n[1/5] 🔍 Scanning x402 ecosystem..."
node "$SCRIPTS_DIR/discovery.js" 2>&1 | tail -10

# ═══════════════════════════════════════════════════════════════════
# 2. 评估机会，生成队列
# ═══════════════════════════════════════════════════════════════════
echo -e "\n[2/5] 📊 Assessing opportunities..."
node "$SCRIPTS_DIR/opportunity-assessment.js" 2>&1 | tail -15

# ═══════════════════════════════════════════════════════════════════
# 3. 自动生成端点代码
# ═══════════════════════════════════════════════════════════════════
echo -e "\n[3/5] 🔧 Generating endpoints..."
GENERATE_RESULT=$(node "$SCRIPTS_DIR/generate-endpoint.js" 2>&1)
echo "$GENERATE_RESULT" | tail -20

# 检查是否生成成功
if echo "$GENERATE_RESULT" | grep -q "All generated endpoints passed review"; then
  REVIEW_PASSED=true
else
  REVIEW_PASSED=false
fi

# ═══════════════════════════════════════════════════════════════════
# 4. 审查状态
# ═══════════════════════════════════════════════════════════════════
echo -e "\n[4/5] 📋 Review status: $([ "$REVIEW_PASSED" = true ] && echo "✅ PASSED" || echo "❌ FAILED")"

# ═══════════════════════════════════════════════════════════════════
# 5. 如果审查通过，自动提交
# ═══════════════════════════════════════════════════════════════════
if [ "$REVIEW_PASSED" = true ]; then
  echo -e "\n[5/5] 🚀 Auto-committing..."
  
  NEW_COUNT=$(jq '.results | length' "$DATA_DIR/review-report.json" 2>/dev/null || echo "0")
  
  if [ "$NEW_COUNT" -gt 0 ]; then
    bash "$SCRIPTS_DIR/auto-commit.sh" 2>&1 | tail -15
    echo "  ✅ Committed and pushed $NEW_COUNT endpoint(s)"
  else
    echo "  No new endpoints to commit."
  fi
else
  echo -e "\n[5/5] ⏸️  Skipping commit (review failed)"
fi

# ═══════════════════════════════════════════════════════════════════
# 生成报告
# ═══════════════════════════════════════════════════════════════════
REPORT="$DATA_DIR/opportunity-pipeline-$TODAY.json"
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
  }
}
EOF

echo -e "\n╔══════════════════════════════════════════════════════════════════╗"
echo "║              Opportunity Pipeline Complete ✅                   ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo "Report: $REPORT"

if [ "$REVIEW_PASSED" = true ] && [ "$NEW_COUNT" -gt 0 ]; then
  echo -e "\n🎉 New endpoints ready! Server will update at 5:30."
fi
