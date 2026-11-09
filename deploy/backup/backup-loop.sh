#!/bin/sh
# Giai đoạn 14: tiến trình của container `backup`. Mỗi ngày lúc BACKUP_TIME (HH:MM, theo TZ) chạy backup.sh;
# ngày BACKUP_VERIFY_WEEKDAY (1 = thứ Hai ... 7 = Chủ nhật) chạy thêm verify-restore.sh.
# Dùng vòng lặp thay cho crond để giữ nguyên biến môi trường PG* của container.
set -u

DIR="$(dirname "$0")"
TIME="${BACKUP_TIME:-02:30}"
LAST=""
echo "[backup-loop] started, daily backup at $TIME ($(date +%Z)), verify on weekday ${BACKUP_VERIFY_WEEKDAY:-7}"

while true; do
    NOW="$(date +%H:%M)"
    TODAY="$(date +%Y-%m-%d)"
    if [ "$NOW" = "$TIME" ] && [ "$LAST" != "$TODAY" ]; then
        LAST="$TODAY"
        if sh "$DIR/backup.sh"; then
            if [ "$(date +%u)" = "${BACKUP_VERIFY_WEEKDAY:-7}" ]; then
                sh "$DIR/verify-restore.sh" || echo "[backup-loop] restore verification FAILED" >&2
            fi
        else
            echo "[backup-loop] backup FAILED" >&2
        fi
    fi
    sleep 30
done
