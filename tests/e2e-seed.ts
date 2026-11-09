/**
 * Chuẩn bị DB test cho smoke test giao diện (Playwright ở repo Web): chạy migration, xóa dữ liệu, tạo dữ liệu mẫu.
 * In ra một dòng JSON (bắt đầu bằng `E2E_FIXTURE=`) chứa username theo vai trò để test đăng nhập.
 *
 *   npx tsx tests/e2e-seed.ts
 */
import { loadTestEnv } from "./env";

loadTestEnv();

const main = async () => {
    const { default: migrate } = await import("./global-setup");
    await migrate();
    const h = await import("./helpers");
    const { pool } = await import("~/config/db");
    try {
        await h.resetDatabase();
        const f = await h.baseFixture();
        await h.createDish("Phở bò", 60000);
        await h.createDish("Trà đá", 5000, "drink");
        await h.createIngredient("Thịt bò");
        // Tài khoản bị khóa sẵn để thử thông báo khóa và nút mở khóa
        const locked = await h.createUser("waitstaff", f.r1, { username: "e2e_locked", fullName: "Nhân viên Bị Khóa", login: false });
        await h.q("UPDATE accounts SET locked_until = NOW() + interval '15 minutes' WHERE id = $1", [locked.accountId]);

        // Giai đoạn 13: tài khoản khách hàng
        const guest = await h.createUser("guest", null, { username: "e2e_guest", fullName: "Khách E2E", login: false });
        await h.q("UPDATE users SET phone_number = $2, email = $3 WHERE id = $1", [guest.userId, "0909000111", "khach.e2e@example.com"]);

        const users = Object.fromEntries(Object.entries(f.users).map(([role, u]) => [role, u.username]));
        console.log(
            "E2E_FIXTURE=" +
                JSON.stringify({ password: h.PASSWORD, users: { ...users, locked: locked.username, guest: guest.username }, restaurants: [f.r1, f.r2] }),
        );
    } finally {
        await pool.end();
    }
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
