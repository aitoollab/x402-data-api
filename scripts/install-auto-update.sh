#!/bin/bash
# 一键安装自动更新系统
# 在服务器上运行此脚本

set -e

WORK_DIR="/opt/x402-data-api"
SCRIPT_NAME="auto-update.sh"

echo "=== x402 API 自动更新系统安装 ==="

# 1. 下载更新脚本
echo "[1/4] 下载自动更新脚本..."
mkdir -p "$WORK_DIR/scripts"
curl -sL "https://raw.githubusercontent.com/aitoollab/x402-data-api/main/scripts/auto-update.sh" -o "$WORK_DIR/scripts/$SCRIPT_NAME"
chmod +x "$WORK_DIR/scripts/$SCRIPT_NAME"
chown root:root "$WORK_DIR/scripts/$SCRIPT_NAME"

# 2. 创建日志目录
echo "[2/4] 创建日志目录..."
touch /var/log/x402-auto-update.log
chmod 666 /var/log/x402-auto-update.log

# 3. 设置 cron 定时任务（每天凌晨3点检查更新）
echo "[3/4] 设置定时任务..."
CRON_JOB="0 3 * * * /bin/bash $WORK_DIR/scripts/$SCRIPT_NAME >> /var/log/x402-auto-update.log 2>&1"

# 检查是否已存在
if crontab -l 2>/dev/null | grep -q "auto-update.sh"; then
  echo "  定时任务已存在，更新..."
  crontab -l 2>/dev/null | grep -v "auto-update.sh" | crontab -
fi
(crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
echo "  定时任务已添加（每天凌晨3点检查更新）"

# 4. 首次运行
echo "[4/4] 首次检查更新..."
$WORK_DIR/scripts/$SCRIPT_NAME

echo ""
echo "=== 安装完成! ==="
echo ""
echo "自动更新已启用："
echo "  - 每天凌晨 3:00 检查 GitHub 更新"
echo "  - 自动拉取并重启 PM2"
echo "  - 日志: /var/log/x402-auto-update.log"
echo ""
echo "手动触发更新: $WORK_DIR/scripts/$SCRIPT_NAME"
echo "查看日志: tail -f /var/log/x402-auto-update.log"
