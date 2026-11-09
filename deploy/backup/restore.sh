#!/bin/sh
# Giai đoạn 14: khôi phục một bản sao lưu ĐÈ lên DB của môi trường. Dừng backend trước (xem deploy/README.md):
#   docker compose -p rm-production ... stop backend
#   docker compose -p rm-production ... run --rm backup sh /scripts/restore.sh /backups/daily/<file>.dump --yes
#   docker compose -p rm-production ... up -d backend
# Trước khi ghi đè, script tự sao lưu DB hiện tại thành /backups/manual/..._before-restore.dump.
set -eu

FILE="${1:-}"
CONFIRM="${2:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
    echo "Usage: restore.sh <file.dump> --yes" >&2
    exit 1
fi
if [ "$CONFIRM" != "--yes" ]; then
    echo "This overwrites database \"$PGDATABASE\" on $PGHOST. Re-run with --yes to continue." >&2
    exit 1
fi

pg_restore --list "$FILE" > /dev/null
sh "$(dirname "$0")/backup.sh" before-restore

echo "[restore] $(date -Iseconds) restoring $FILE into $PGDATABASE"
# Ngắt các kết nối khác rồi tạo lại DB trống: khôi phục sạch, không lẫn bảng / trigger cũ
psql -d postgres -v ON_ERROR_STOP=1 -q <<SQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$PGDATABASE' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS "$PGDATABASE";
CREATE DATABASE "$PGDATABASE";
SQL
pg_restore --no-owner --exit-on-error --dbname="$PGDATABASE" "$FILE"
echo "[restore] done. Start the backend again."
