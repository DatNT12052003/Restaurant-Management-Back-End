import { beforeAll, describe, expect, it } from "vitest";
import { api, auditRows, bearer, createRestaurant, createUser, login, PASSWORD, q } from "./helpers";

const WRONG = "Wrong@pass1";

describe("Xác thực", () => {
    let restaurantId: number;

    beforeAll(async () => {
        restaurantId = await createRestaurant("Nhà hàng Auth");
    });

    it("đăng nhập đúng trả access token, refresh token, ghi nhật ký và thời điểm đăng nhập", async () => {
        const u = await createUser("waitstaff", restaurantId, { login: false });
        const res = await api().post("/api/auth/login").send({ username: u.username, password: PASSWORD });
        expect(res.status).toBe(200);
        expect(res.body.data.access_token).toBeTruthy();
        expect(res.body.data.refresh_token).toBeTruthy();
        const [acc] = await q("SELECT last_login_at FROM accounts WHERE id = $1", [u.accountId]);
        expect(acc.last_login_at).not.toBeNull();
        const logs = (await auditRows("auth.login")).filter((l) => l.account_id === u.accountId);
        expect(logs).toHaveLength(1);
        expect(logs[0].restaurant_id).toBe(restaurantId);
    });

    it("sai mật khẩu và username không tồn tại đều bị từ chối và ghi nhật ký", async () => {
        const u = await createUser("waitstaff", restaurantId, { login: false });
        expect((await api().post("/api/auth/login").send({ username: u.username, password: WRONG })).status).toBe(400);
        expect((await api().post("/api/auth/login").send({ username: "khong_ton_tai", password: WRONG })).status).toBe(400);
        const logs = await auditRows("auth.login_failed");
        expect(logs.some((l) => l.account_id === u.accountId && l.after.reason === "invalid_password")).toBe(true);
        expect(logs.some((l) => l.account_id === null && l.actor_name === "khong_ton_tai")).toBe(true);
    });

    it("nhân viên đã nghỉ không đăng nhập được", async () => {
        const u = await createUser("waitstaff", restaurantId, { login: false, status: "inactive" });
        expect((await api().post("/api/auth/login").send({ username: u.username, password: PASSWORD })).status).toBe(403);
    });

    it("access token sai hoặc thiếu trả 401", async () => {
        expect((await api().get("/api/auth/me")).status).toBe(401);
        expect((await api().get("/api/auth/me").set(bearer("abc.def.ghi"))).status).toBe(401);
    });

    it("/me trả user, vai trò, quyền", async () => {
        const u = await createUser("cashier", restaurantId);
        const res = await api().get("/api/auth/me").set(bearer(u.token));
        expect(res.status).toBe(200);
        expect(res.body.data.roles).toContain("cashier");
        expect(res.body.data.permissions).toContain("payment.view");
    });

    it("refresh token chỉ dùng được một lần; đăng xuất thu hồi token", async () => {
        const u = await createUser("waitstaff", restaurantId, { login: false });
        const first = await api().post("/api/auth/login").send({ username: u.username, password: PASSWORD });
        const refresh = first.body.data.refresh_token;
        const r1 = await api().post("/api/auth/refresh").send({ refresh_token: refresh });
        expect(r1.status).toBe(200);
        expect((await api().post("/api/auth/refresh").send({ refresh_token: refresh })).status).toBe(400);
        const r2 = r1.body.data.refresh_token;
        expect((await api().post("/api/auth/logout").send({ refresh_token: r2 })).status).toBe(200);
        expect((await api().post("/api/auth/refresh").send({ refresh_token: r2 })).status).toBe(400);
        expect((await auditRows("auth.logout")).some((l) => l.account_id === u.accountId)).toBe(true);
    });

    it("đổi mật khẩu: sai mật khẩu hiện tại bị từ chối; đổi xong mật khẩu cũ không dùng được", async () => {
        const u = await createUser("waitstaff", restaurantId);
        const bad = await api()
            .post("/api/auth/change-password")
            .set(bearer(u.token))
            .send({ current_password: WRONG, new_password: "New@pass123", confirm_password: "New@pass123" });
        expect(bad.status).toBe(400);
        const ok = await api()
            .post("/api/auth/change-password")
            .set(bearer(u.token))
            .send({ current_password: PASSWORD, new_password: "New@pass123", confirm_password: "New@pass123" });
        expect(ok.status).toBe(200);
        expect((await api().post("/api/auth/login").send({ username: u.username, password: PASSWORD })).status).toBe(400);
        await login(u.username, "New@pass123");
    });

    it("nhật ký không bao giờ chứa mật khẩu", async () => {
        const rows = await q(`SELECT count(*)::int AS c FROM audit_logs WHERE before::text ILIKE '%password%' OR after::text ILIKE $1`, [
            `%${PASSWORD}%`,
        ]);
        expect(rows[0].c).toBe(0);
    });
});

describe("Khóa tài khoản khi đăng nhập sai nhiều lần", () => {
    let restaurantId: number;

    beforeAll(async () => {
        restaurantId = await createRestaurant("Nhà hàng Khóa");
    });

    const fail = (username: string) => api().post("/api/auth/login").send({ username, password: WRONG });

    it("sai 4 lần chưa khóa; lần thứ 5 khóa 15 phút, kể cả nhập đúng mật khẩu", async () => {
        const u = await createUser("waitstaff", restaurantId, { login: false });
        for (let i = 0; i < 4; i++) expect((await fail(u.username)).status).toBe(400);
        const fifth = await fail(u.username);
        expect(fifth.status).toBe(403);
        expect(fifth.body.message).toMatch(/15/);

        const right = await api().post("/api/auth/login").send({ username: u.username, password: PASSWORD });
        expect(right.status).toBe(403);

        const [acc] = await q("SELECT locked_until, failed_login_count FROM accounts WHERE id = $1", [u.accountId]);
        const minutes = (new Date(acc.locked_until).getTime() - Date.now()) / 60_000;
        expect(minutes).toBeGreaterThan(14);
        expect(minutes).toBeLessThanOrEqual(15);
        expect(acc.failed_login_count).toBe(0);

        const locked = (await auditRows("auth.account_locked")).filter((l) => l.account_id === u.accountId);
        expect(locked).toHaveLength(1);
        const reasons = (await auditRows("auth.login_failed")).filter((l) => l.account_id === u.accountId).map((l) => l.after.reason);
        expect(reasons.filter((r) => r === "locked")).toHaveLength(1);
    });

    it("đăng nhập đúng xóa bộ đếm: sai 4 lần, đúng 1 lần, sai tiếp 4 lần vẫn chưa khóa", async () => {
        const u = await createUser("waitstaff", restaurantId, { login: false });
        for (let i = 0; i < 4; i++) await fail(u.username);
        await login(u.username);
        for (let i = 0; i < 4; i++) expect((await fail(u.username)).status).toBe(400);
        await login(u.username);
    });

    it("lần sai đầu tiên đã quá 15 phút thì đếm lại từ đầu", async () => {
        const u = await createUser("waitstaff", restaurantId, { login: false });
        for (let i = 0; i < 4; i++) await fail(u.username);
        await q("UPDATE accounts SET first_failed_at = NOW() - interval '16 minutes' WHERE id = $1", [u.accountId]);
        expect((await fail(u.username)).status).toBe(400);
        const [acc] = await q("SELECT failed_login_count, locked_until FROM accounts WHERE id = $1", [u.accountId]);
        expect(acc.failed_login_count).toBe(1);
        expect(acc.locked_until).toBeNull();
    });

    it("hết thời gian khóa thì đăng nhập lại được", async () => {
        const u = await createUser("waitstaff", restaurantId, { login: false });
        await q("UPDATE accounts SET locked_until = NOW() - interval '1 second' WHERE id = $1", [u.accountId]);
        await login(u.username);
    });

    it("5 lần sai đồng thời vẫn khóa đúng một lần", async () => {
        const u = await createUser("waitstaff", restaurantId, { login: false });
        const results = await Promise.all(Array.from({ length: 5 }, () => fail(u.username)));
        expect(results.filter((r) => r.status === 403)).toHaveLength(1);
        const [acc] = await q("SELECT locked_until FROM accounts WHERE id = $1", [u.accountId]);
        expect(acc.locked_until).not.toBeNull();
    });

    it("giới hạn tần suất theo IP trả 429 khi bật", async () => {
        process.env.RATE_LIMIT_DISABLED = "false";
        try {
            let last = 0;
            for (let i = 0; i < 31; i++) {
                last = (await api().post("/api/auth/login").send({ username: "khong_ai_ca", password: WRONG })).status;
            }
            expect(last).toBe(429);
        } finally {
            process.env.RATE_LIMIT_DISABLED = "true";
        }
    });
});
