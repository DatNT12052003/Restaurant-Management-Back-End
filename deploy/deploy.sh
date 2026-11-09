#!/usr/bin/env bash
# Giai đoạn 14: triển khai một phiên bản lên một môi trường trên máy chủ (GitHub Actions gọi qua SSH, hoặc chạy tay).
#   ./deploy.sh <production|staging> <backend|web> <tag>
# Ví dụ: ./deploy.sh staging backend sha-1a2b3c4
#
# - Ghi tag vào <môi trường>/versions.env (lần sau triển khai phần kia vẫn giữ tag này).
# - Production: sao lưu DB trước khi chạy migration (nhãn pre-deploy).
# - Kéo image, chạy migration (service migrate), khởi động lại, chờ backend báo sẵn sàng; lỗi thì in log và trả mã lỗi.
set -euo pipefail

ENV_NAME="${1:?environment: production | staging}"
COMPONENT="${2:?component: backend | web}"
TAG="${3:?image tag}"

case "$ENV_NAME" in production | staging) ;; *) echo "Unknown environment $ENV_NAME" >&2; exit 1 ;; esac
case "$COMPONENT" in backend | web) ;; *) echo "Unknown component $COMPONENT" >&2; exit 1 ;; esac
[[ "$TAG" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Invalid tag $TAG" >&2; exit 1; }

cd "$(dirname "$0")"
ENV_DIR="./$ENV_NAME"
[ -f "$ENV_DIR/.env" ] || { echo "Missing $ENV_DIR/.env (copy env/stack.env.example)" >&2; exit 1; }
[ -f "$ENV_DIR/backend.env" ] || { echo "Missing $ENV_DIR/backend.env (copy env/backend.env.example)" >&2; exit 1; }
touch "$ENV_DIR/versions.env"

VAR="$(echo "$COMPONENT" | tr '[:lower:]' '[:upper:]')_TAG"
grep -v "^$VAR=" "$ENV_DIR/versions.env" > "$ENV_DIR/versions.env.tmp" || true
echo "$VAR=$TAG" >> "$ENV_DIR/versions.env.tmp"
mv "$ENV_DIR/versions.env.tmp" "$ENV_DIR/versions.env"

dc() { docker compose --env-file "$ENV_DIR/.env" --env-file "$ENV_DIR/versions.env" -f docker-compose.yml "$@"; }

docker network inspect edge > /dev/null 2>&1 || docker network create edge > /dev/null

echo "==> [$ENV_NAME] pulling images ($VAR=$TAG)"
dc pull --quiet

if [ "$COMPONENT" = "backend" ] && [ "$ENV_NAME" = "production" ] && [ -n "$(dc ps -q db 2> /dev/null)" ]; then
    echo "==> [$ENV_NAME] backup before migration"
    dc run --rm --no-deps backup sh /scripts/backup.sh pre-deploy
fi

echo "==> [$ENV_NAME] starting (migrations run first)"
dc up -d --remove-orphans

echo "==> [$ENV_NAME] waiting for backend to be healthy"
for _ in $(seq 1 40); do
    STATUS="$(docker inspect --format '{{.State.Health.Status}}' "$(dc ps -q backend)" 2> /dev/null || echo starting)"
    if [ "$STATUS" = "healthy" ]; then
        echo "==> [$ENV_NAME] deployed $COMPONENT $TAG"
        docker image prune -f > /dev/null
        exit 0
    fi
    sleep 3
done

echo "!! [$ENV_NAME] backend not healthy, recent logs:" >&2
dc logs --tail 80 migrate backend >&2 || true
exit 1
