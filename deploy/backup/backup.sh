#!/bin/sh
# Giai đoạn 14: sao lưu DB bằng pg_dump (định dạng custom, nén), xoay vòng bản ngày / tuần / tháng.
# Chạy trong container `backup` (biến PG* trỏ tới DB của môi trường). Dùng tay:
#   docker compose -p rm-production ... run --rm backup sh /scripts/backup.sh [nhãn]
# Nhãn (tùy chọn, ví dụ "pre-deploy") được ghi vào tên file và không bị xoay vòng xóa.
set -eu

ROOT=/backups
LABEL="${1:-}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$ROOT/daily" "$ROOT/weekly" "$ROOT/monthly" "$ROOT/manual"

if [ -n "$LABEL" ]; then
    TARGET="$ROOT/manual/${PGDATABASE}_${STAMP}_${LABEL}.dump"
else
    TARGET="$ROOT/daily/${PGDATABASE}_${STAMP}.dump"
fi

echo "[backup] $(date -Iseconds) dumping $PGDATABASE -> $TARGET"
# Ghi ra file tạm rồi đổi tên: bản dở dang (lỗi giữa chừng) không bao giờ mang tên .dump
pg_dump --format=custom --compress=6 --no-owner --file="$TARGET.partial"
mv "$TARGET.partial" "$TARGET"
# Kiểm tra nhanh: đọc được mục lục của bản sao lưu
pg_restore --list "$TARGET" > /dev/null
SIZE="$(du -h "$TARGET" | cut -f1)"
echo "[backup] done ($SIZE)"

if [ -z "$LABEL" ]; then
    # Chủ nhật: giữ thêm một bản tuần; ngày 1: một bản tháng
    [ "$(date +%u)" = "7" ] && cp "$TARGET" "$ROOT/weekly/"
    [ "$(date +%d)" = "01" ] && cp "$TARGET" "$ROOT/monthly/"

    prune() {
        dir="$1"
        keep="$2"
        # Tên file có dấu thời gian nên sắp theo tên là sắp theo thời gian
        ls -1 "$dir"/*.dump 2> /dev/null | sort -r | tail -n +"$((keep + 1))" | while read -r old; do
            echo "[backup] prune $old"
            rm -f "$old"
        done
    }
    prune "$ROOT/daily" "${BACKUP_KEEP_DAILY:-7}"
    prune "$ROOT/weekly" "${BACKUP_KEEP_WEEKLY:-8}"
    prune "$ROOT/monthly" "${BACKUP_KEEP_MONTHLY:-12}"
fi

printf '{"time":"%s","file":"%s","size":"%s"}\n' "$(date -Iseconds)" "$TARGET" "$SIZE" > "$ROOT/last-backup.json"
