#!/bin/bash
# 自动提交脚本
# 检查审查结果，通过则合并代码并提交

set -e

SCRIPTS_DIR="$(dirname "$0")"
DATA_DIR="$SCRIPTS_DIR/../data"
REVIEW_FILE="$DATA_DIR/review-report.json"
GENERATED_DIR="$DATA_DIR/generated"
INDEX_FILE="$SCRIPTS_DIR/../index.js"

# Git push 重试函数
git_push_with_retry() {
  local max_attempts=5
  local attempt=1
  local base_delay=7
  
  while [ $attempt -le $max_attempts ]; do
    echo "  Attempt $attempt/$max_attempts..."
    
    if git push "$@" 2>&1; then
      echo "  ✅ Push successful!"
      return 0
    fi
    
    if [ $attempt -lt $max_attempts ]; then
      local delay=$((7 * attempt))
      echo "  ⚠️  Push failed. Retrying in ${delay}s..."
      sleep "$delay"
    fi
    
    attempt=$((attempt + 1))
  done
  
  echo "  ❌ Push failed after $max_attempts attempts"
  return 1
}

echo "=== Auto Commit Script ==="

# 检查审查报告是否存在
if [ ! -f "$REVIEW_FILE" ]; then
  echo "No review report found. Run review-endpoints.js first."
  exit 1
fi

# 检查审查是否通过
ALL_PASSED=$(jq '.allPassed' "$REVIEW_FILE" 2>/dev/null || echo "false")

if [ "$ALL_PASSED" != "true" ]; then
  echo "❌ Review not passed. Cannot commit."
  echo "Check: $REVIEW_FILE"
  exit 1
fi

echo "✅ Review passed. Proceeding with commit..."

# 检查是否有生成的端点
GENERATED_COUNT=$(jq '.passed' "$REVIEW_FILE" 2>/dev/null || echo "0")

if [ "$GENERATED_COUNT" -eq 0 ]; then
  echo "No endpoints to commit."
  exit 0
fi

# 合并端点到 index.js
echo -e "\n[1/4] Merging endpoints into index.js..."

# 生成的端点用 START/END 标记包裹，便于后续清理重复
START_MARKER="// === GENERATED ENDPOINTS START ==="
END_MARKER="// === ENDPOINTS END ==="

# 先清理之前可能存在的旧生成端点
if grep -q "$START_MARKER" "$INDEX_FILE" && grep -q "$END_MARKER" "$INDEX_FILE"; then
  echo "  Cleaning up previous generated endpoints..."
  # 删除 START_MARKER 到 END_MARKER 之间的所有内容（包括两个标记）
  sed -i "/$START_MARKER/,/$END_MARKER/{ /$START_MARKER/{ r /dev/stdin
d }; /$END_MARKER/d; d }" "$INDEX_FILE" 2>/dev/null || \
  awk "/$START_MARKER/{skip=1; next} /$END_MARKER/{skip=0; next} !skip" "$INDEX_FILE" > "${INDEX_FILE}.tmp" && mv "${INDEX_FILE}.tmp" "$INDEX_FILE"
fi

# 找到插入点
if grep -q "$END_MARKER" "$INDEX_FILE"; then
  LINE_NUM=$(grep -n "$END_MARKER" "$INDEX_FILE" | head -1 | cut -d: -f1)
  echo "  Insert before line: $LINE_NUM"
  
  # 获取所有生成的端点代码，加上 START 标记
  TEMP_FILE=$(mktemp)
  echo "$START_MARKER" >> "$TEMP_FILE"
  for file in "$GENERATED_DIR"/*.js; do
    if [ -f "$file" ]; then
      echo "" >> "$TEMP_FILE"
      cat "$file" >> "$TEMP_FILE"
      echo "  Added: $(basename $file)"
    fi
  done
  
  # 使用 awk 在标记行之前插入
  awk -v line="$LINE_NUM" -v file="$TEMP_FILE" '
    NR == line { while ((getline line < file) > 0) print line; close(file) }
    { print }
  ' "$INDEX_FILE" > "${INDEX_FILE}.tmp" && mv "${INDEX_FILE}.tmp" "$INDEX_FILE"
  
  rm "$TEMP_FILE"
else
  echo "  Warning: No insert marker found. Manual merge required."
  exit 1
fi

# 更新版本号
echo -e "\n[2/4] Updating version..."
CURRENT_VERSION=$(grep '"version":' "$INDEX_FILE" | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
echo "  Current version: $CURRENT_VERSION"

# 提交变更
echo -e "\n[3/4] Committing changes..."
git add -A
COMMIT_MSG="feat: auto-add endpoints from pipeline

- Added $GENERATED_COUNT new endpoint(s)
- Review passed at: $(jq -r '.timestamp' "$REVIEW_FILE")
- Endpoints: $(jq -r '.results[].file' "$REVIEW_FILE" | tr '\n' ' ')"

git commit -m "$COMMIT_MSG" || echo "No changes to commit"

# 推送
echo -e "\n[4/4] Pushing to GitHub (with retry)..."
git_push_with_retry

echo -e "\n✅ Done! Endpoints committed and pushed."
echo "Server will auto-update at scheduled time."
