# Triển khai (giai đoạn 14)

Một máy chủ VPS chạy Docker, gồm hai môi trường độc lập (**production** và **staging**, mỗi môi trường DB riêng) và một reverse proxy chung.

```
Internet ──443──> Caddy (deploy/proxy, TLS tự động)
                    ├─ PROD_DOMAIN    ──> rm-production-web ──/api, /socket.io──> backend ──> db
                    └─ STAGING_DOMAIN ──> rm-staging-web    ──/api, /socket.io──> backend ──> db
```

- **web** (image từ repo Web): nginx phục vụ bản build React và chuyển `/api`, `/socket.io` tới backend. Web và API cùng tên miền nên không cần CORS hay cookie khác miền.
- **migrate**: chạy `npm run migrate:prod` rồi thoát. Backend chỉ khởi động khi migration thành công.
- **backup**: `pg_dump` hằng ngày, xoay vòng, kiểm tra phục hồi hằng tuần (thư mục `backup/`).

## Cài lần đầu

Yêu cầu: Docker Engine 24 trở lên và Compose v2.17 trở lên. Hai tên miền (hoặc tên miền phụ) trỏ về IP máy chủ. Mở cổng 80 và 443.

```bash
sudo mkdir -p /opt/restaurant && sudo chown $USER /opt/restaurant
# Chép thư mục deploy/ của repo backend vào /opt/restaurant (GitHub Actions cũng tự đồng bộ mỗi lần triển khai)
cd /opt/restaurant
docker network create edge

# Đăng nhập GHCR một lần (Personal Access Token có quyền read:packages)
echo <token> | docker login ghcr.io -u <github-user> --password-stdin

# Reverse proxy
cp proxy/.env.example proxy/.env      # sửa tên miền, email, mật khẩu staging
docker compose -f proxy/docker-compose.yml --env-file proxy/.env up -d

# Từng môi trường
for env in production staging; do
  mkdir -p $env/backups
  cp env/stack.env.example   $env/.env          # STACK_NAME=rm-$env, APP_ENV=$env, BACKUP_DIR=./$env/backups, mật khẩu DB
  cp env/backend.env.example $env/backend.env   # tên miền, bí mật JWT (khác nhau giữa 2 môi trường), Cloudinary, mail, SePay
done
chmod 600 */.env */backend.env proxy/.env

./deploy.sh staging backend staging && ./deploy.sh staging web staging
./deploy.sh production backend production && ./deploy.sh production web production
```

Lần đầu đặt `SEED_ADMIN_PASSWORD` trong `<env>/.env` để tạo tài khoản admin. Đăng nhập, đổi mật khẩu, rồi xóa giá trị này.

## CI/CD

Mỗi repo có `.github/workflows/deploy.yml`:

| Nhánh | Kết quả |
|---|---|
| Pull request | Chạy CI (test, lint, build) |
| `develop` | CI → build image `ghcr.io/<owner>/restaurant-management-{backend,web}:sha-xxxxxxx` (và tag `staging`) → triển khai staging |
| `main` | CI → build image (tag `production`) → triển khai production |

Cấu hình trên GitHub cho **mỗi repo**:
- Variable `DEPLOY_ENABLED=true`. Khi chưa đặt, workflow chỉ build image.
- Environments `staging` và `production`, mỗi environment có secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` (và `DEPLOY_PORT` nếu không dùng 22), cùng variable `DEPLOY_PATH` (mặc định `/opt/restaurant`).
- Nên bật **Required reviewers** cho environment `production`.

Backend và web triển khai độc lập. `deploy.sh` ghi tag vào `<env>/versions.env`, nên lần triển khai web không đổi tag backend, và ngược lại.

Quay lại phiên bản cũ: `./deploy.sh production backend sha-<commit cũ>`. Migration không tự chạy ngược. Nếu bản mới đã đổi schema, khôi phục bản sao lưu `pre-deploy` (xem bên dưới).

## Sao lưu và phục hồi

- Hằng ngày lúc `BACKUP_TIME` (giờ VN): `backups/daily/`. Chủ nhật chép thêm một bản vào `weekly/`, ngày 1 hằng tháng chép vào `monthly/`. Số bản giữ lại cấu hình bằng các biến `BACKUP_KEEP_*`.
- Production: `deploy.sh` sao lưu trước khi chạy migration (`backups/manual/*_pre-deploy.dump`). Thư mục `manual/` không bị xoay vòng, nên phải dọn tay.
- Kiểm tra phục hồi hằng tuần (ngày `BACKUP_VERIFY_WEEKDAY`): khôi phục bản mới nhất vào một DB tạm, kiểm tra migration, vai trò, các bảng chính, phân vùng và trigger nhật ký, rồi xóa DB tạm. Kết quả ghi ở `backups/last-verify.json`.
- **Sao lưu ngoài máy chủ:** chép `backups/` ra nơi khác hằng ngày, ví dụ dùng cron của máy chủ chạy `rclone sync /opt/restaurant/production/backups remote:restaurant-backups`. Bản sao lưu chỉ nằm trên cùng VPS thì mất khi VPS hỏng.

```bash
dc() { docker compose --env-file production/.env --env-file production/versions.env -f docker-compose.yml "$@"; }

dc run --rm backup sh /scripts/backup.sh manual          # sao lưu ngay
dc run --rm backup sh /scripts/verify-restore.sh         # kiểm tra phục hồi bản mới nhất

# Khôi phục (ghi đè DB). Script tự sao lưu DB hiện tại trước khi ghi đè.
dc stop backend
dc run --rm backup sh /scripts/restore.sh /backups/daily/<file>.dump --yes
dc up -d backend
```

## Giám sát và log

- `GET /api/health`: tiến trình còn sống. `GET /api/health/ready`: kết nối được DB. Docker healthcheck dùng endpoint này, và đây cũng là URL nên đặt cho dịch vụ uptime (UptimeRobot, Better Stack...).
- Lỗi: đặt `SENTRY_DSN` trong `backend.env` (Sentry, hoặc GlitchTip tự cài). Mọi `logger.error` đều được gửi lên, kèm môi trường (`APP_ENV`) và phiên bản (tag image).
- Log: backend ghi JSON ra stdout. Docker giữ tối đa 5 file 20 MB cho mỗi container. Mỗi request có mã `X-Request-Id` (trả về trong response và ghi trong log). Có thể gom log tập trung bằng Loki/Promtail hoặc Vector đọc log của Docker.
- `docker compose ... logs -f backend` để xem trực tiếp.

## Chuyển khoản VietQR và SePay

1. Admin vào **Nhà hàng** → sửa chi nhánh → mục "Chuyển khoản QR": chọn ngân hàng, nhập số tài khoản và tên chủ tài khoản, rồi bật.
2. Trên SePay: liên kết tài khoản ngân hàng đó, tạo webhook với URL `https://<tên miền>/api/payment-gateway/webhooks/sepay`, chọn kiểu xác thực **API Key** và đặt giá trị trùng với `SEPAY_WEBHOOK_API_KEY`.
3. Staging dùng tiền tố mã khác (`PAYMENT_REF_PREFIX`) để không bắt nhầm giao dịch của production nếu hai môi trường dùng chung tài khoản.

Giao dịch không khớp mã, sai số tiền, hoặc đến sau khi order đã đóng sẽ nằm ở **Thanh toán → Đối soát chuyển khoản**, để ghi nhận tay hoặc bỏ qua.
