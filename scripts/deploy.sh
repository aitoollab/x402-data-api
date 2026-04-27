#!/bin/bash
# x402 API 自动部署脚本
# 用法: ./deploy.sh [commit_message]

set -e

COMMIT_MSG="${1:-auto update}"
SERVER_USER="root"
SERVER_HOST="43.155.218.228"
SERVER_PATH="/opt/x402-data-api"

echo "=== x402 API Deployment ==="

# 1. 本地提交
echo -e "\n[1/4] Committing changes..."
git add .
git commit -m "$COMMIT_MSG" || echo "Nothing to commit"

# 2. 推送到 GitHub
echo -e "\n[2/4] Pushing to GitHub..."
git push origin main

# 3. 更新服务器
echo -e "\n[3/4] Updating server..."
ssh "$SERVER_USER@$SERVER_HOST" << 'EOF'
cd /opt/x402-data-api
curl -sL https://raw.githubusercontent.com/aitoollab/x402-data-api/main/index.js -o index.js
pm2 restart x402-api
sleep 2
pm2 status
EOF

# 4. 验证部署
echo -e "\n[4/4] Verifying deployment..."
sleep 3

HEALTH=$(curl -s https://api.aitoollab.top/api/health)
echo "Health check: $HEALTH"

VERSION=$(curl -s https://api.aitoollab.top/ | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
echo "API version: $VERSION"

echo -e "\n=== Deployment complete! ==="
