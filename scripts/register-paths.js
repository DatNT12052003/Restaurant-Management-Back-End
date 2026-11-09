/**
 * Giai đoạn 14: `tsc` không đổi alias `~/...` khi build, nên bản build trong `dist/` cần đăng ký lại alias lúc chạy.
 * Dùng: `node -r ./scripts/register-paths.js dist/server.js` (lệnh `npm start`). Đặt `APP_DIST` nếu thư mục build khác.
 */
const path = require("path");

require("tsconfig-paths").register({
    baseUrl: process.env.APP_DIST || path.join(__dirname, "..", "dist"),
    paths: { "~/*": ["*"] },
});
