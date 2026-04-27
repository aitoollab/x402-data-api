#!/bin/bash
# 飞书通知脚本
# 发送执行结果到飞书

set -e

# 飞书 Webhook URL（需要创建机器人获取）
# 或者使用 API 直接发送消息给用户

FEISHU_WEBHOOK="${FEISHU_WEBHOOK:-}"
USER_OPEN_ID="ou_07a2fd659071ffb580d48cdf91961c4b"
BOT_APP_ID="${FEISHU_APP_ID:-}"
BOT_APP_SECRET="${FEISHU_APP_SECRET:-}"

# 获取访问令牌
get_token() {
  if [ -z "$BOT_APP_ID" ] || [ -z "$BOT_APP_SECRET" ]; then
    echo "Feishu credentials not configured"
    return 1
  fi
  
  curl -s "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal" \
    -H "Content-Type: application/json" \
    -d "{\"app_id\":\"$BOT_APP_ID\",\"app_secret\":\"$BOT_APP_SECRET\"}" | \
    jq -r '.tenant_access_token'
}

# 发送消息给用户
send_message() {
  local title="$1"
  local content="$2"
  
  # 方式1: 使用 webhook（如果配置了）
  if [ -n "$FEISHU_WEBHOOK" ]; then
    curl -s "$FEISHU_WEBHOOK" \
      -H "Content-Type: application/json" \
      -d "{
        \"msg_type\": \"interactive\",
        \"card\": {
          \"header\": {
            \"title\": { \"tag\": \"plain_text\", \"content\": \"$title\" },
            \"template\": \"blue\"
          },
          \"elements\": [
            { \"tag\": \"markdown\", \"content\": \"$content\" }
          ]
        }
      }"
    return $?
  fi
  
  # 方式2: 使用 API（需要配置 app_id 和 app_secret）
  local token=$(get_token)
  if [ -z "$token" ] || [ "$token" = "null" ]; then
    echo "Failed to get token"
    return 1
  fi
  
  curl -s "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id" \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    -d "{
      \"receive_id\": \"$USER_OPEN_ID\",
      \"msg_type\": \"interactive\",
      \"content\": \"{
        \\\"type\\\": \\\"template\\\",
        \\\"data\\\": {
          \\\"template_id\\\": \\\"AAqk2D2KQeGwP\\\",
          \\\"template_variable\\\": {
            \\\"title\\\": \\\"$title\\\",
            \\\"content\\\": \\\"$content\\\"
          }
        }
      }\"
    }"
}

# 主函数
main() {
  local type="$1"
  local title="$2"
  local content="$3"
  
  case "$type" in
    "pipeline")
      send_message "🦞 $title" "$content"
      ;;
    "alert")
      send_message "⚠️ $title" "$content"
      ;;
    "revenue")
      send_message "💰 $title" "$content"
      ;;
    "daily")
      send_message "📊 $title" "$content"
      ;;
    *)
      send_message "$title" "$content"
      ;;
  esac
}

# 如果直接执行
if [ "${BASH_SOURCE[0]}" == "$0" ]; then
  main "$@"
fi
