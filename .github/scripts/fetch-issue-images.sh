#!/usr/bin/env bash
#
# 把 issue 內文抓成檔案，並把內文裡的截圖附件下載到指定目錄。
#
#   fetch-issue-images.sh <issue 編號> <內文輸出檔> <截圖輸出目錄>
#
# schema-design / epic-breakdown / tdd-develop 三支 workflow 共用這一段。
# 原本三支各自維護幾乎相同的 pipeline，結果是「修一支忘兩支」——
# tdd-develop 早就修好了 gh 的 fail fast，另外兩支沒跟上（issue #27）。
#
# agent 看不到 issue 內文裡的 <img src="..."> 這段 HTML 文字，
# 所以截圖必須先抓成本地檔案，它才能用 Read 真的看過每一張畫面。
set -euo pipefail

ISSUE="${1:?用法: fetch-issue-images.sh <issue 編號> <內文輸出檔> <截圖輸出目錄>}"
BODY_FILE="${2:?用法: fetch-issue-images.sh <issue 編號> <內文輸出檔> <截圖輸出目錄>}"
IMAGE_DIR="${3:?用法: fetch-issue-images.sh <issue 編號> <內文輸出檔> <截圖輸出目錄>}"

mkdir -p "$IMAGE_DIR" "$(dirname "$BODY_FILE")"

# ── 先把內文抓成檔案，再從檔案取 URL ──
# 這一行是 bare command，不是 pipeline 的開頭，這點是刻意的：
# 放進 pipeline 的話，結束狀態取自最後一個元素（讀不到輸入而正常結束的迴圈），
# gh 失敗會被完全吞掉 → step 存活但產出 0 張截圖 → agent 只憑文字硬做設計。
# 現在 gh 一失敗，errexit 當場中止，step 直接紅。
#
# 只取 .body：留言區在 public repo 上任何人都能寫，不能混進 agent 的素材。
gh issue view "$ISSUE" --json body --jq '.body' > "$BODY_FILE"

# grep 找不到任何一筆時回 1，而「沒有截圖」是合法情況（例如純邏輯 issue），
# 所以這裡用 || true。來源是檔案而不是 pipeline，所以這個 || true
# 不會像舊寫法那樣連帶把 gh 的失敗一起吞掉。
urls=$(grep -oE 'https://github\.com/user-attachments/assets/[0-9a-fA-F-]+' "$BODY_FILE" \
  | awk '!seen[$0]++' || true)

if [ -z "$urls" ]; then
  echo "issue #$ISSUE 的內文沒有截圖附件，$IMAGE_DIR 保持為空"
  exit 0
fi

expected=$(printf '%s\n' "$urls" | wc -l | tr -d ' ')
echo "issue #$ISSUE 的內文含 $expected 張截圖附件"

index=0
while IFS= read -r url; do
  index=$((index + 1))
  # --retry 系列：CDN 抖一次不該燒掉一次人工核准——這一步在 schema-design 與
  # develop 裡都是在 environment 的核准「之後」才執行的。
  # --retry-all-errors 是必要的：少了它，curl 只重試少數幾種被歸類為
  # 暫時性的錯誤，連線被中斷這類情況不會重試。
  if ! curl -sSLf --retry 3 --retry-delay 2 --retry-all-errors \
    -o "$IMAGE_DIR/screen-$index.png" "$url"; then
    echo "::error::第 $index 張截圖下載失敗（重試後仍失敗）：$url"
    exit 1
  fi
done <<EOF
$urls
EOF

# ── 明確斷言數量 ──
# 下載全部回 0 不代表檔案真的都在（磁碟寫入失敗、curl 行為改變…）。
# 數量對不上時要用清楚的訊息讓 step 失敗，而不是讓 agent 拿著半套素材硬做。
actual=$(find "$IMAGE_DIR" -maxdepth 1 -type f -name 'screen-*.png' | wc -l | tr -d ' ')
if [ "$actual" -ne "$expected" ]; then
  echo "::error::截圖數量不符：內文有 $expected 張，實際下載到 $actual 張"
  exit 1
fi

echo "已下載 $actual 張截圖到 $IMAGE_DIR"
