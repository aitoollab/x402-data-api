#!/bin/bash
# 自动提交脚本
# 检查审查结果，通过则合并代码并提交

set -e

SCRIPTS_DIR="$(dirname "$0")"
DATA_DIR="$SCRIPTS_DIR/../data"
REVIEW_FILE="$DATA_DIR/review-report.json"
GENERATED_DIR="$DATA_DIR/generated"
INDEX_FILE="$SCRIPTS_DIR/../index.js"

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

# 在 index.js 中找到插入点（在最后一个端点之后）
INSERT_MARKER="ENDPOINTS END"

if grep -q "$INSERT_MARKER" "$INDEX_FILE"; then
  # 找到标记的行号
  LINE_NUM=$(grep -n "$INSERT_MARKER" "$INDEX_FILE" | head -1 | cut -d: -f1)
  echo "  Insert before line: $LINE_NUM"
  
  # 获取所有生成的端点代码
  TEMP_FILE=$(mktemp)
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
echo -e "\n[4/4] Pushing to GitHub..."
git push

echo -e "\n✅ Done! Endpoints committed and pushed."
echo "Server will auto-update at scheduled time."
