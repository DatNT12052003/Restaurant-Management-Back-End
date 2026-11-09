#!/bin/sh
# Giai đoạn 14: kiểm tra phục hồi (đặc tả 6.4). Khôi phục bản sao lưu mới nhất (hoặc file truyền vào) vào một DB tạm
# trên cùng máy chủ PostgreSQL, kiểm tra dữ liệu chính, rồi xóa DB tạm. Kết quả ghi vào /backups/last-verify.json.
#   docker compose -p rm-production ... run --rm backup sh /scripts/verify-restore.sh [file.dump]
set -eu

ROOT=/backups
FILE="${1:-$(ls -1t "$ROOT"/daily/*.dump "$ROOT"/manual/*.dump 2> /dev/null | head -n 1)}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
    echo "[verify] no backup file found" >&2
    exit 1
fi

CHECK_DB="restore_check_$(date +%Y%m%d%H%M%S)"
cleanup() { psql -d postgres -qc "DROP DATABASE IF EXISTS \"$CHECK_DB\"" > /dev/null 2>&1 || true; }
trap cleanup EXIT

fail() {
    echo "[verify] FAILED: $1" >&2
    printf '{"time":"%s","file":"%s","ok":false,"error":"%s"}\n' "$(date -Iseconds)" "$FILE" "$1" > "$ROOT/last-verify.json"
    exit 1
}

echo "[verify] $(date -Iseconds) restoring $FILE into $CHECK_DB"
psql -d postgres -qc "CREATE DATABASE \"$CHECK_DB\"" || fail "cannot create check database"
pg_restore --no-owner --exit-on-error --dbname="$CHECK_DB" "$FILE" || fail "pg_restore error"

q() { psql -d "$CHECK_DB" -Atc "$1"; }

# Migration đã chạy, có vai trò / quyền, các bảng chính đọc được, nhật ký vẫn phân vùng và chỉ cho thêm
MIGRATIONS="$(q "SELECT count(*) FROM pgmigrations")"
[ "$MIGRATIONS" -gt 0 ] || fail "pgmigrations is empty"
ROLES="$(q "SELECT count(*) FROM roles WHERE deleted_at IS NULL")"
[ "$ROLES" -gt 0 ] || fail "no roles"
for t in restaurants users orders payments inventory audit_logs; do
    q "SELECT count(*) FROM $t" > /dev/null || fail "cannot read table $t"
done
PARTS="$(q "SELECT count(*) FROM pg_inherits i JOIN pg_class p ON p.oid = i.inhparent WHERE p.relname = 'audit_logs'")"
[ "$PARTS" -gt 0 ] || fail "audit_logs partitions missing"
TRIGGERS="$(q "SELECT count(*) FROM pg_trigger WHERE tgname = 'audit_logs_protect_row'")"
[ "$TRIGGERS" -gt 0 ] || fail "audit_logs protection trigger missing"

# So với DB đang chạy: số migration phải bằng (bản sao lưu không cũ hơn lần migrate gần nhất)
LIVE_MIGRATIONS="$(psql -Atc "SELECT count(*) FROM pgmigrations")"
SUMMARY="migrations=$MIGRATIONS/$LIVE_MIGRATIONS orders=$(q "SELECT count(*) FROM orders") payments=$(q "SELECT count(*) FROM payments")"
echo "[verify] ok: $SUMMARY"
printf '{"time":"%s","file":"%s","ok":true,"summary":"%s"}\n' "$(date -Iseconds)" "$FILE" "$SUMMARY" > "$ROOT/last-verify.json"
if [ "$MIGRATIONS" != "$LIVE_MIGRATIONS" ]; then
    echo "[verify] warning: backup has $MIGRATIONS migrations, live database has $LIVE_MIGRATIONS (backup older than last deploy)"
fi
