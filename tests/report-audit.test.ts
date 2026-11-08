import { beforeAll, describe, expect, it } from "vitest";
import { auditLogService } from "~/services";
import { pool } from "~/config/db";
import { api, auditRows, baseFixture, bearer, createDish, Fixture, q, settle } from "./helpers";

let f: Fixture;
let admin: { Authorization: string };
const TZ = "Asia/Ho_Chi_Minh";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
    f = await baseFixture();
    admin = bearer(f.users.admin.token);
    const dish = await createDish("Gà nướng", 150000);
    const drink = await createDish("Bia", 30000, "drink");
    // Hôm qua 18:00–20:00 trên bàn B1 (giờ Việt Nam): order hoàn tất 2 gà + 2 bia = 360.000, thu chuyển khoản
    const y = shift(today(), -1);
    const local = (time: string) => `(($2::date + time '${time}') AT TIME ZONE '${TZ}')`;
    const [o] = await q(
        `INSERT INTO orders (code, restaurant_id, guest_count, status, subtotal, total, created_at, completed_at)
        VALUES ('T-1', $1, 4, 'completed', 360000, 360000, ${local("18:00")}, ${local("20:00")}) RETURNING id`,
        [f.r1, y],
    );
    const [round] = await q("INSERT INTO order_rounds (order_id, round_no) VALUES ($1, 1) RETURNING id", [o.id]);
    await q(
        `INSERT INTO order_items (order_id, round_id, dish_id, quantity, current_price, station, status)
        VALUES ($1, $2, $3, 2, 150000, 'kitchen', 'served'), ($1, $2, $4, 2, 30000, 'bar', 'served'),
               ($1, $2, $4, 5, 30000, 'bar', 'cancelled')`,
        [o.id, round.id, dish, drink],
    );
    await q(
        `INSERT INTO order_tables (order_id, table_id, assigned_at, released_at) VALUES ($1, $3, ${local("18:00")}, ${local("20:00")})`,
        [o.id, y, f.tables.t1],
    );
    await q(
        `INSERT INTO payments (order_id, restaurant_id, type, method, amount, status, paid_at)
        VALUES ($1, $3, 'payment', 'transfer', 360000, 'paid', ${local("19:55")})`,
        [o.id, y, f.r1],
    );
});

describe("Báo cáo", () => {
    it("tổng quan: thực thu, order, khách, so với kỳ trước", async () => {
        const res = await api().get(`/api/reports/overview?from=${shift(today(), -1)}&to=${today()}&restaurant_id=${f.r1}`).set(admin);
        expect(res.status).toBe(200);
        expect(res.body.data.current).toMatchObject({ net_revenue: 360000, completed_orders: 1, guests: 4, avg_order_value: 360000 });
        expect(res.body.data.previous.net_revenue).toBe(0);
        expect(res.body.data.previous_range.to).toBe(shift(today(), -2));
    });

    it("doanh thu theo ngày có đủ kỳ trống, theo phương thức", async () => {
        const res = await api().get(`/api/reports/revenue?from=${shift(today(), -2)}&to=${today()}&group_by=day`).set(admin);
        const series = res.body.data.series;
        expect(series.map((p: any) => p.period)).toEqual([shift(today(), -2), shift(today(), -1), today()]);
        expect(series[1].net).toBe(360000);
        expect(res.body.data.by_method).toEqual([expect.objectContaining({ method: "transfer", net: 360000 })]);
    });

    it("món bán chạy bỏ dòng đã hủy", async () => {
        const res = await api().get(`/api/reports/top-items?from=${shift(today(), -1)}&to=${today()}`).set(admin);
        const beer = res.body.data.dishes.find((d: any) => d.name === "Bia");
        expect(beer).toMatchObject({ quantity: 2, revenue: 60000 });
    });

    it("lấp đầy bàn: 2 giờ-bàn, giờ 18 và 19 có khách", async () => {
        const y = shift(today(), -1);
        const res = await api().get(`/api/reports/table-occupancy?from=${y}&to=${y}&restaurant_id=${f.r1}`).set(admin);
        expect(res.body.data.summary.occupied_hours).toBe(2);
        // 6 bàn × 14 giờ (08:00–22:00) × 1 ngày
        expect(res.body.data.summary.available_hours).toBe(6 * 14);
        expect(res.body.data.by_hour[18].occupied_hours).toBe(1);
        expect(res.body.data.by_hour[19].occupied_hours).toBe(1);
    });

    it("khoảng ngày sai trả 400; manager bị giới hạn chi nhánh; phục vụ không có quyền", async () => {
        expect((await api().get(`/api/reports/revenue?from=${today()}&to=${shift(today(), -1)}`).set(admin)).status).toBe(400);
        expect((await api().get(`/api/reports/revenue?from=2020-01-01&to=${today()}`).set(admin)).status).toBe(400);
        const m = bearer(f.users.manager.token);
        expect((await api().get(`/api/reports/overview?restaurant_id=${f.r2}`).set(m)).status).toBe(403);
        const own = await api().get(`/api/reports/overview?from=${shift(today(), -1)}&to=${today()}`).set(m);
        expect(own.body.data.current.net_revenue).toBe(360000);
        const other = await api().get(`/api/reports/overview?from=${shift(today(), -1)}&to=${today()}`).set(bearer(f.users.manager2.token));
        expect(other.body.data.current.net_revenue).toBe(0);
        expect((await api().get("/api/reports/overview").set(bearer(f.users.waiter.token))).status).toBe(403);
    });
});

describe("Nhật ký hoạt động", () => {
    it("CRUD qua auditRoute chỉ ghi trường đổi; xem chi tiết; manager chỉ thấy chi nhánh mình", async () => {
        await api().patch(`/api/tables/${f.tables.t2}`).set(bearer(f.users.manager.token)).send({ capacity: 5 });
        await settle();
        const [log] = await auditRows("table.update");
        expect(log.after).toEqual({ capacity: 5 });
        expect(log.before).toEqual({ capacity: 4 });

        const mine = await api().get("/api/audit-logs?limit=100").set(bearer(f.users.manager.token));
        expect(mine.status).toBe(200);
        expect(mine.body.data.audit_logs.every((l: any) => l.restaurant_id === f.r1)).toBe(true);
        expect((await api().get(`/api/audit-logs/${log.id}`).set(bearer(f.users.manager2.token))).status).toBe(404);
        const detail = await api().get(`/api/audit-logs/${log.id}`).set(bearer(f.users.manager.token));
        expect(detail.body.data.after).toEqual({ capacity: 5 });
    });

    it("ghi nhật ký thao tác ảnh (đặt ảnh đại diện; không gọi Cloudinary)", async () => {
        const dish = await createDish("Có ảnh", 1000);
        const imgs = await q(
            `INSERT INTO images (entity_type, entity_id, url, is_primary) VALUES ('dish', $1, 'http://x/a.jpg', true), ('dish', $1, 'http://x/b.jpg', false)
            RETURNING id`,
            [dish],
        );
        const res = await api().patch(`/api/images/${imgs[1].id}/primary`).set(admin);
        expect(res.status).toBe(200);
        await settle();
        const [log] = await auditRows("image.set_primary");
        expect(log.entity_id).toBe(imgs[1].id);
    });

    it("bảng nhật ký không sửa / xóa được", async () => {
        const [row] = await q("SELECT id FROM audit_logs LIMIT 1");
        await expect(pool.query("UPDATE audit_logs SET action = 'x' WHERE id = $1", [row.id])).rejects.toThrow(/append-only/);
        await expect(pool.query("DELETE FROM audit_logs WHERE id = $1", [row.id])).rejects.toThrow(/append-only/);
        await expect(pool.query("TRUNCATE audit_logs")).rejects.toThrow(/append-only/);
    });

    it("lưu trữ: chuyển dòng cũ hơn 12 tháng sang bảng lưu trữ, ghi một dòng audit.archive; bảng lưu trữ không xóa được", async () => {
        const [old] = await q(
            `INSERT INTO audit_logs (action, entity_type, created_at) VALUES ('test.old', 'test', NOW() - interval '13 months') RETURNING id`,
        );
        await q(`INSERT INTO audit_logs (action, entity_type, created_at) VALUES ('test.recent', 'test', NOW() - interval '11 months')`);
        const moved = await auditLogService.archiveOldAuditLogs();
        expect(moved).toBe(1);
        expect(await q("SELECT 1 FROM audit_logs WHERE id = $1", [old.id])).toHaveLength(0);
        expect(await q("SELECT 1 FROM audit_logs_archive WHERE id = $1 AND action = 'test.old'", [old.id])).toHaveLength(1);
        expect(await q("SELECT 1 FROM audit_logs WHERE action = 'test.recent'")).toHaveLength(1);
        expect((await auditRows("audit.archive"))[0].after).toMatchObject({ moved: 1, months: 12 });
        await expect(pool.query("DELETE FROM audit_logs_archive WHERE id = $1", [old.id])).rejects.toThrow(/append-only/);
        // Ngoài job lưu trữ, DELETE vẫn bị chặn
        await expect(pool.query("DELETE FROM audit_logs WHERE action = 'test.recent'")).rejects.toThrow(/append-only/);
    });
});
