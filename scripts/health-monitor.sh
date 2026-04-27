#!/bin/bash
# x402 API 运维监控
# 健康检查 + 端点统计 + 收益跟踪

set -e

SCRIPTS_DIR="$(dirname "$0")"
DATA_DIR="$SCRIPTS_DIR/../data"
TODAY=$(date +%Y-%m-%d)
API_URL="https://api.aitoollab.top"
WALLET="0x1D99D952eAd3E8907c9989D15303d3Bcc443Ef97"

mkdir -p "$DATA_DIR"

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║            x402 Health Monitor - $TODAY                       ║"
echo "╚══════════════════════════════════════════════════════════════════╝"

# ═══════════════════════════════════════════════════════════════════
# 1. 检查 API 服务状态
# ═══════════════════════════════════════════════════════════════════
echo -e "\n[1/4] 🏥 Checking API service..."

HEALTH=$(curl -s "$API_URL/api/health" 2>/dev/null || echo '{"status":"error"}')
echo "$HEALTH" | head -5

# ═══════════════════════════════════════════════════════════════════
# 2. 检查端点健康
# ═══════════════════════════════════════════════════════════════════
echo -e "\n[2/4] 🔍 Checking endpoints..."

# 获取端点列表
X402_INFO=$(curl -s "$API_URL/.well-known/x402" 2>/dev/null || echo '{}')
ENDPOINTS=$(echo "$X402_INFO" | jq -r '.resources | length' 2>/dev/null || echo "0")
echo "  Total endpoints: $ENDPOINTS"

# 抽查关键端点
HEALTHY=0
FAILED=0
FAILED_ENDPOINTS=""

CHECK_ENDPOINTS=(
  "/api/crypto/price/btc"
  "/api/crypto/trending"
  "/api/defi/yields"
  "/api/weather/beijing"
  "/api/agent/score/0x1D99D952eAd3E8907c9989D15303d3Bcc443Ef97"
  "/api/whale/transactions"
)

for endpoint in "${CHECK_ENDPOINTS[@]}"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL$endpoint" 2>/dev/null || echo "000")
  if [ "$CODE" = "402" ]; then
    HEALTHY=$((HEALTHY + 1))
    echo "  ✅ $endpoint: $CODE"
  else
    FAILED=$((FAILED + 1))
    FAILED_ENDPOINTS="$FAILED_ENDPOINTS $endpoint"
    echo "  ❌ $endpoint: $CODE"
  fi
done

echo -e "\n  Summary: $HEALTHY healthy, $FAILED failed"

# ═══════════════════════════════════════════════════════════════════
# 3. 收益跟踪
# ═══════════════════════════════════════════════════════════════════
echo -e "\n[3/4] 💰 Revenue tracking..."
echo "  Wallet: $WALLET"
echo "  Network: Base (eip155:8453)"
echo "  Explorer: https://basescan.org/address/$WALLET"

# 检查服务器日志中的付款记录
if command -v pm2 &> /dev/null; then
  echo -e "\n  Recent payments (from PM2 logs):"
  pm2 logs x402-api --lines 100 --nostream 2>/dev/null | grep -i "payment\|paid\|402" | tail -5 || echo "    No recent payments found"
fi

# ═══════════════════════════════════════════════════════════════════
# 4. x402scan 注册状态
# ═══════════════════════════════════════════════════════════════════
echo -e "\n[4/4] 📊 x402scan registration..."

SCAN_INFO=$(curl -s "https://api.x402scan.com/v1/servers?wallet=$WALLET" 2>/dev/null || echo '{}')
REGISTERED=$(echo "$SCAN_INFO" | jq -r '.servers | length' 2>/dev/null || echo "0")
echo "  Registered on x402scan: $REGISTERED server(s)"

if [ "$REGISTERED" -gt 0 ]; then
  echo "$SCAN_INFO" | jq -r '.servers[] | "    - \(.name): \(.endpoints | length) endpoints"' 2>/dev/null | head -3
fi

# ═══════════════════════════════════════════════════════════════════
# 生成报告
# ═══════════════════════════════════════════════════════════════════
REPORT="$DATA_DIR/health-monitor-$TODAY.json"
cat > "$REPORT" << EOF
{
  "date": "$TODAY",
  "timestamp": "$(date -Iseconds)",
  "service": {
    "status": "$([ "$HEALTHY" -gt 0 ] && echo "healthy" || echo "degraded")",
    "endpoints": $ENDPOINTS,
    "healthy": $HEALTHY,
    "failed": $FAILED,
    "failed_endpoints": "$FAILED_ENDPOINTS"
  },
  "wallet": "$WALLET",
  "x402scan_registered": $REGISTERED
}
EOF

echo -e "\n╔══════════════════════════════════════════════════════════════════╗"
echo "║               Health Monitor Complete ✅                        ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo "Report: $REPORT"

# 如果有失败的端点，发出警告
if [ "$FAILED" -gt 0 ]; then
  echo -e "\n⚠️  WARNING: $FAILED endpoint(s) failed health check!"
  echo "Failed: $FAILED_ENDPOINTS"
fi
