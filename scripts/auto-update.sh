#!/bin/bash
# x402 API 自动更新脚本
# 检测 GitHub 仓库更新并自动部署

set -e

REPO_URL="https://github.com/aitoollab/x402-data-api"
BRANCH="main"
WORK_DIR="/opt/x402-data-api"
PM2_APP="x402-api"
LOG_FILE="/var/log/x402-auto-update.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# 确保日志文件可写
touch "$LOG_FILE" 2>/dev/null || LOG_FILE="/tmp/x402-auto-update.log"

cd "$WORK_DIR" || {
  log "ERROR: Cannot cd to $WORK_DIR"
  exit 1
}

# 获取本地和远程的最新 commit
LOCAL_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "none")
REMOTE_COMMIT=$(git ls-remote origin "$BRANCH" 2>/dev/null | cut -f1)

if [ -z "$REMOTE_COMMIT" ]; then
  log "ERROR: Cannot reach GitHub"
  exit 1
fi

log "Local:  $LOCAL_COMMIT"
log "Remote: $REMOTE_COMMIT"

# 检查是否需要更新
if [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ]; then
  log "No updates available"
  exit 0
fi

log "NEW VERSION DETECTED! Updating..."

# 拉取最新代码
git fetch origin
git reset --hard "origin/$BRANCH"

# 重启 PM2
pm2 restart "$PM2_APP"

# 等待并验证
sleep 3

# 检查服务状态
HEALTH=$(curl -s https://api.aitoollab.top/api/health 2>/dev/null || echo '{"status":"error"}')
VERSION=$(curl -s https://api.aitoollab.top/ 2>/dev/null | grep -o '"version":"[^"]*"' | cut -d'"' -f4)

log "Update complete!"
log "Version: $VERSION"
log "Health: $HEALTH"

# 记录更新历史
echo "$REMOTE_COMMIT $(date '+%Y-%m-%d %H:%M:%S')" >> /opt/x402-data-api/.update-history
