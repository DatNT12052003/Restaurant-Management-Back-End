import { beforeAll, describe, expect, it } from "vitest";
import { api, auditRows, baseFixture, bearer, createUser, Fixture, login, PASSWORD, q } from "./helpers";

let f: Fixture;

beforeAll(async () => {
    f = await baseFixture();
});

const roleId = async (type: string) => (await q("SELECT id FROM roles WHERE type_name = $1", [type]))[0].id as number;
const rolePerms = async (type: string) =>
    (
        await q(
            `SELECT p.type_name FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
            WHERE r.type_name = $1 AND rp.deleted_at IS NULL ORDER BY 1`,
            [type],
        )
    ).map((r) => r.type_name as string);

describe("Phân quyền", () => {
    it("vai trò admin bị khóa, không sửa được quyền", async () => {
        const res = await api()
            .put(`/api/roles/${await roleId("admin")}/permissions`)
            .set(bearer(f.users.admin.token))
            .send({ permissions: [] });
        expect(res.status).toBe(403);
    });

    it("manager không có permission.assign theo mặc định", async () => {
        const res = await api()
            .put(`/api/users/${f.users.waiter.userId}/permissions`)
            .set(bearer(f.users.manager.token))
            .send({ permissions: ["order.cancel"] });
        expect(res.status).toBe(403);
    });

    it("admin gỡ rồi cấp lại một quyền cho vai trò (khôi phục dòng đã xóa mềm) và ghi nhật ký", async () => {
        const id = await roleId("guard");
        const original = await rolePerms("guard");
        const url = `/api/roles/${id}/permissions`;
        const admin = bearer(f.users.admin.token);
        expect((await api().put(url).set(admin).send({ permissions: [...original, "dish.view"] })).status).toBe(200);
        expect((await api().put(url).set(admin).send({ permissions: original })).status).toBe(200);
        expect((await api().put(url).set(admin).send({ permissions: [...original, "dish.view"] })).status).toBe(200);
        expect(await rolePerms("guard")).toContain("dish.view");
        const logs = (await auditRows("role.permissions_update")).filter((l) => l.entity_id === id);
        expect(logs).toHaveLength(3);
        expect(logs[0].after.added).toEqual(["dish.view"]);
        expect(logs[1].after.removed).toEqual(["dish.view"]);
        expect(logs[0].restaurant_id).toBeNull();
        await api().put(url).set(admin).send({ permissions: original });
    });

    it("cấp quyền riêng cho user: có hiệu lực ngay, cấp lại sau khi gỡ vẫn được, không đổi thì không ghi nhật ký", async () => {
        const waiter = await createUser("waitstaff", f.r1);
        const url = `/api/users/${waiter.userId}/permissions`;
        const admin = bearer(f.users.admin.token);
        expect((await api().get("/api/reports/overview").set(bearer(waiter.token))).status).toBe(403);
        expect((await api().put(url).set(admin).send({ permissions: ["report.view"] })).status).toBe(200);
        expect((await api().get("/api/reports/overview").set(bearer(waiter.token))).status).toBe(200);
        await api().put(url).set(admin).send({ permissions: [] });
        expect((await api().put(url).set(admin).send({ permissions: ["report.view"] })).status).toBe(200);
        await api().put(url).set(admin).send({ permissions: ["report.view"] });
        const logs = (await auditRows("user.permissions_update")).filter((l) => l.entity_id === waiter.userId);
        expect(logs).toHaveLength(3);
        expect(logs[0].restaurant_id).toBe(f.r1);
    });

    it("người không phải admin chỉ cấp được quyền mình đang có", async () => {
        const id = await roleId("waitstaff");
        // Cấp tạm permission.assign cho manager chi nhánh 1 qua quyền riêng
        await api()
            .put(`/api/users/${f.users.manager.userId}/permissions`)
            .set(bearer(f.users.admin.token))
            .send({ permissions: ["permission.assign"] });
        const current = await rolePerms("waitstaff");
        const res = await api()
            .put(`/api/roles/${id}/permissions`)
            .set(bearer(f.users.manager.token))
            .send({ permissions: [...current, "audit_log.view", "permission.assign", "role.delete"] });
        expect(res.status).toBe(403);
        await api().put(`/api/users/${f.users.manager.userId}/permissions`).set(bearer(f.users.admin.token)).send({ permissions: [] });
    });

    it("không quản lý được người cùng cấp hoặc cấp trên", async () => {
        const res = await api()
            .patch(`/api/users/employee/${f.users.manager2.userId}`)
            .set(bearer(f.users.manager.token))
            .field("full_name", "Đổi tên");
        expect(res.status).toBe(403);
    });

    it("manager không xem được dữ liệu chi nhánh khác", async () => {
        const res = await api().get(`/api/rooms?restaurant_id=${f.r2}`).set(bearer(f.users.manager.token));
        expect(res.status).toBe(403);
    });
});

describe("Quản lý tài khoản", () => {
    it("manager thấy tài khoản nhân viên chi nhánh mình, có vai trò và trạng thái khóa", async () => {
        const res = await api().get("/api/accounts?kind=employee&limit=100").set(bearer(f.users.manager.token));
        expect(res.status).toBe(200);
        const rows = res.body.data.accounts;
        expect(rows.length).toBeGreaterThan(5);
        expect(rows.every((r: any) => r.restaurant_id === f.r1)).toBe(true);
        const waiter = rows.find((r: any) => r.user_id === f.users.waiter.userId);
        expect(waiter.roles).toEqual(["waitstaff"]);
        expect(waiter.is_locked).toBe(false);
        expect(waiter.last_login_at).not.toBeNull();
        expect(rows[0]).not.toHaveProperty("hash_password");
    });

    it("manager không xem được tài khoản chi nhánh khác; admin xem được cả chuỗi", async () => {
        expect((await api().get(`/api/accounts?restaurant_id=${f.r2}`).set(bearer(f.users.manager.token))).status).toBe(403);
        const all = await api().get("/api/accounts?limit=100").set(bearer(f.users.admin.token));
        const restaurants = new Set(all.body.data.accounts.map((r: any) => r.restaurant_id));
        expect(restaurants.has(f.r1) && restaurants.has(f.r2)).toBe(true);
    });

    it("phục vụ không có quyền xem tài khoản", async () => {
        expect((await api().get("/api/accounts").set(bearer(f.users.waiter.token))).status).toBe(403);
    });

    it("lọc tài khoản đang bị khóa, mở khóa và ghi nhật ký", async () => {
        const u = await createUser("waitstaff", f.r1, { login: false });
        for (let i = 0; i < 5; i++) await api().post("/api/auth/login").send({ username: u.username, password: "Wrong@123" });
        const locked = await api().get("/api/accounts?locked=true").set(bearer(f.users.manager.token));
        expect(locked.body.data.accounts.map((r: any) => r.user_id)).toEqual([u.userId]);

        const res = await api().post(`/api/users/${u.userId}/account/unlock`).set(bearer(f.users.manager.token));
        expect(res.status).toBe(200);
        await login(u.username);
        const logs = (await auditRows("account.unlock")).filter((l) => l.entity_id === u.accountId);
        expect(logs).toHaveLength(1);
        expect(logs[0].before.locked_until).not.toBeNull();
        expect(logs[0].restaurant_id).toBe(f.r1);
    });

    it("đăng xuất từ xa thu hồi mọi refresh token", async () => {
        const u = await createUser("waitstaff", f.r1, { login: false });
        const s = await api().post("/api/auth/login").send({ username: u.username, password: PASSWORD });
        const res = await api().post(`/api/users/${u.userId}/account/logout-all`).set(bearer(f.users.manager.token));
        expect(res.status).toBe(200);
        expect(res.body.data.revoked).toBeGreaterThanOrEqual(1);
        expect((await api().post("/api/auth/refresh").send({ refresh_token: s.body.data.refresh_token })).status).toBe(400);
    });

    it("đặt lại mật khẩu: mật khẩu cũ hết hiệu lực, mở khóa, kiểm tra xác nhận mật khẩu", async () => {
        const u = await createUser("waitstaff", f.r1, { login: false });
        await q("UPDATE accounts SET locked_until = NOW() + interval '10 minutes' WHERE id = $1", [u.accountId]);
        const url = `/api/users/${u.userId}/account/reset-password`;
        const mismatch = await api().post(url).set(bearer(f.users.manager.token)).send({ new_password: "Moi@12345", confirm_password: "khac" });
        expect(mismatch.status).toBe(400);
        const ok = await api().post(url).set(bearer(f.users.manager.token)).send({ new_password: "Moi@12345", confirm_password: "Moi@12345" });
        expect(ok.status).toBe(200);
        expect((await api().post("/api/auth/login").send({ username: u.username, password: PASSWORD })).status).toBe(400);
        await login(u.username, "Moi@12345");
        const logs = await auditRows("account.reset_password");
        expect(JSON.stringify(logs)).not.toContain("Moi@12345");
    });

    it("không thao tác được trên tài khoản cấp trên hoặc chi nhánh khác; thu ngân không có quyền", async () => {
        const m = bearer(f.users.manager.token);
        expect((await api().post(`/api/users/${f.users.admin.userId}/account/unlock`).set(m)).status).toBe(403);
        expect((await api().post(`/api/users/${f.users.waiter2.userId}/account/unlock`).set(m)).status).toBe(403);
        expect((await api().post(`/api/users/${f.users.waiter.userId}/account/unlock`).set(bearer(f.users.cashier.token))).status).toBe(403);
    });

    it("user không có tài khoản trả 404", async () => {
        const [u] = await q("INSERT INTO users (full_name, restaurant_id) VALUES ('Không TK', $1) RETURNING id", [f.r1]);
        await q("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE type_name = 'waitstaff'", [u.id]);
        expect((await api().post(`/api/users/${u.id}/account/unlock`).set(bearer(f.users.manager.token))).status).toBe(404);
    });
});
