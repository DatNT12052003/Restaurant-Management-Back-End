import { beforeAll, describe, expect, it } from "vitest";
import { api, auditRows, baseFixture, bearer, createDish, createTable, Fixture, q } from "./helpers";

let f: Fixture;
const H = 60 * 60 * 1000;
/** Giờ hẹn cách hiện tại `hours` giờ, làm tròn phút */
const at = (hours: number) => new Date(Math.round((Date.now() + hours * H) / 60_000) * 60_000).toISOString();

beforeAll(async () => {
    f = await baseFixture();
});

const reserve = (token: string, body: Record<string, unknown>) =>
    api()
        .post("/api/reservations")
        .set(bearer(token))
        .send({ contact_name: "Khách A", contact_phone: "0901234567", guest_count: 2, ...body });

describe("Đặt bàn", () => {
    it("lễ tân đặt bàn; trùng giờ trên cùng bàn bị từ chối; giờ liền kề thì được", async () => {
        const token = f.users.receptionist.token;
        const a = await reserve(token, { start_time: at(24), end_time: at(26), table_ids: [f.tables.t1] });
        expect(a.status).toBe(201);
        expect(a.body.data.restaurant_id).toBe(f.r1);
        const clash = await reserve(token, { start_time: at(25), end_time: at(27), table_ids: [f.tables.t1] });
        expect(clash.status).toBeGreaterThanOrEqual(400);
        const next = await reserve(token, { start_time: at(26), end_time: at(28), table_ids: [f.tables.t1] });
        expect(next.status).toBe(201);
    });

    it("không đủ ghế bị từ chối; bàn chi nhánh khác bị từ chối", async () => {
        const token = f.users.receptionist.token;
        expect((await reserve(token, { guest_count: 10, start_time: at(30), end_time: at(31), table_ids: [f.tables.t3] })).status).toBe(400);
        const other = await reserve(token, { start_time: at(30), end_time: at(31), table_ids: [f.tables.x1] });
        expect(other.status).toBeGreaterThanOrEqual(400);
    });

    it("3 lượt đặt cùng lúc trên cùng bàn: đúng 1 lượt thành công", async () => {
        const token = f.users.receptionist.token;
        const results = await Promise.all(
            [0, 1, 2].map(() => reserve(token, { start_time: at(40), end_time: at(42), table_ids: [f.tables.t2] })),
        );
        expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    });

    it("máy trạng thái: không đi ngược; khách đến thì mở order và bàn chuyển occupied", async () => {
        const token = f.users.receptionist.token;
        const r = await reserve(token, { start_time: at(0), end_time: at(2), table_ids: [f.tables.t4] });
        expect(r.status).toBe(201);
        const id = r.body.data.id;
        const status = (s: string) => api().patch(`/api/reservations/${id}/status`).set(bearer(token)).send({ status: s });
        expect((await status("completed")).status).toBe(400);
        expect((await status("confirmed")).status).toBe(200);
        expect((await status("arrived")).status).toBe(200);
        const [order] = await q("SELECT id, status FROM orders WHERE reservation_id = $1", [id]);
        expect(order).toBeTruthy();
        const [table] = await q("SELECT status FROM tables WHERE id = $1", [f.tables.t4]);
        expect(table.status).toBe("occupied");
        expect((await status("completed")).status).toBe(400); // order còn mở
    });

    it("phục vụ chỉ xem đặt bàn, không tạo được", async () => {
        expect((await reserve(f.users.waiter.token, { start_time: at(50), end_time: at(51), table_ids: [f.tables.t1] })).status).toBe(403);
    });
});

describe("Order và phục vụ", () => {
    let food: number;
    let drink: number;

    beforeAll(async () => {
        food = await createDish("Cơm rang", 50000, "food");
        drink = await createDish("Cà phê", 25000, "drink");
        // Giá riêng chi nhánh 1 cho cà phê
        await q("INSERT INTO restaurant_dishes (restaurant_id, dish_id, is_available, price) VALUES ($1, $2, true, 30000)", [f.r1, drink]);
    });

    const open = (tableIds: number[], token = f.users.waiter.token) =>
        api().post("/api/orders").set(bearer(token)).send({ table_ids: tableIds, guest_count: 2 });
    const detail = async (id: number) => (await api().get(`/api/orders/${id}`).set(bearer(f.users.admin.token))).body.data;
    const lines = async (id: number) => (await detail(id)).rounds.flatMap((r: any) => r.lines);
    const setLine = (lineId: number, status: string, token: string, extra: Record<string, unknown> = {}) =>
        api().patch(`/api/orders/dishes/${lineId}/status`).set(bearer(token)).send({ status, ...extra });

    it("mở order: bàn chuyển occupied; bàn đã có order mở không mở thêm được", async () => {
        const res = await open([f.tables.t1]);
        expect(res.status).toBe(201);
        expect(res.body.data.code).toMatch(/^R\d+-\d{8}-\d{4}$/);
        expect((await open([f.tables.t1])).status).toBe(400);
    });

    it("3 lần mở order cùng bàn cùng lúc: đúng 1 lần thành công", async () => {
        const results = await Promise.all([0, 1, 2].map(() => open([f.tables.t3])));
        expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    });

    it("gọi món: giá theo chi nhánh, đồ uống vào quầy pha chế, tổng tiền tính lại", async () => {
        const o = (await open([f.tables.v1])).body.data.id;
        const round = await api()
            .post(`/api/orders/${o}/rounds`)
            .set(bearer(f.users.waiter.token))
            .send({ items: [{ dish_id: food, quantity: 2 }, { dish_id: drink, quantity: 1 }] });
        expect(round.status).toBe(201);
        const ls = await lines(o);
        expect(ls.find((l: any) => l.item_id === drink)).toMatchObject({ station: "bar", current_price: "30000.00" });
        expect(ls.find((l: any) => l.item_id === food).station).toBe("kitchen");
        const d = await detail(o);
        expect(Number(d.subtotal)).toBe(130000);
        expect(d.status).toBe("serving");
    });

    it("món bị tắt ở chi nhánh không gọi được", async () => {
        const off = await createDish("Món tắt", 10000);
        await q("INSERT INTO restaurant_dishes (restaurant_id, dish_id, is_available) VALUES ($1, $2, false)", [f.r1, off]);
        const o = (await open([f.tables.v2])).body.data.id;
        const res = await api().post(`/api/orders/${o}/rounds`).set(bearer(f.users.waiter.token)).send({ items: [{ dish_id: off, quantity: 1 }] });
        expect(res.status).toBe(400);
    });

    it("máy trạng thái món và quyền từng bước", async () => {
        const o = (await open([f.tables.t2])).body.data.id;
        await api().post(`/api/orders/${o}/rounds`).set(bearer(f.users.waiter.token)).send({ items: [{ dish_id: food, quantity: 1 }] });
        const [line] = await lines(o);
        expect((await setLine(line.id, "cooking", f.users.waiter.token)).status).toBe(403); // phục vụ không chế biến
        expect((await setLine(line.id, "served", f.users.chef.token)).status).toBe(400); // nhảy cóc
        expect((await setLine(line.id, "cooking", f.users.chef.token)).status).toBe(200);
        expect((await setLine(line.id, "ready", f.users.chef.token)).status).toBe(200);
        expect((await setLine(line.id, "served", f.users.chef.token)).status).toBe(403); // bếp không mang món ra
        expect((await setLine(line.id, "served", f.users.waiter.token)).status).toBe(200);
    });

    it("hủy món ghi nhật ký kèm lý do; hủy order khi chưa phục vụ món nào", async () => {
        const created = await api().post("/api/orders").set(bearer(f.users.admin.token)).send({ restaurant_id: f.r2, table_ids: [f.tables.x1], guest_count: 2 });
        const o = created.body.data.id;
        await api().post(`/api/orders/${o}/rounds`).set(bearer(f.users.admin.token)).send({ items: [{ dish_id: food, quantity: 1 }, { dish_id: drink, quantity: 2 }] });
        const ls = await lines(o);
        const cancel = await setLine(ls[0].id, "cancelled", f.users.admin.token, { cancel_reason: "Khách đổi ý" });
        expect(cancel.status).toBe(200);
        const [log] = (await auditRows("order_item.cancel")).filter((l) => l.after.order_id === o);
        expect(log.after.cancel_reason).toBe("Khách đổi ý");
        expect(log.restaurant_id).toBe(f.r2);

        // phục vụ chi nhánh khác không thấy order này
        expect((await api().get(`/api/orders/${o}`).set(bearer(f.users.waiter.token))).status).toBe(404);
        // phục vụ không có quyền hủy order
        expect((await api().post(`/api/orders/${o}/cancel`).set(bearer(f.users.waiter2.token)).send({})).status).toBe(403);
        const res = await api().post(`/api/orders/${o}/cancel`).set(bearer(f.users.admin.token)).send({ cancel_reason: "Khách về" });
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("cancelled");
        const [table] = await q("SELECT status FROM tables WHERE id = $1", [f.tables.x1]);
        expect(table.status).toBe("cleaning");
        expect((await auditRows("order.cancel")).some((l) => l.entity_id === o)).toBe(true);
    });

    it("chuyển bàn: bàn cũ sang cleaning, bàn mới occupied, order vẫn còn bàn", async () => {
        const from = await createTable(f.rooms.hall, "CB-A");
        const to = await createTable(f.rooms.hall, "CB-B");
        const id = (await open([from])).body.data.id;
        const res = await api()
            .post(`/api/orders/${id}/transfer`)
            .set(bearer(f.users.waiter.token))
            .send({ from_table_id: from, to_table_id: to });
        expect(res.status).toBe(200);
        const statuses = await q("SELECT id, status FROM tables WHERE id = ANY($1)", [[from, to]]);
        expect(statuses.find((t) => t.id === from).status).toBe("cleaning");
        expect(statuses.find((t) => t.id === to).status).toBe("occupied");
        // Không trả được bàn cuối cùng của order
        expect((await api().delete(`/api/orders/${id}/tables/${to}`).set(bearer(f.users.waiter.token))).status).toBe(400);
    });

    it("hàng chờ bếp chỉ có món của trạm tương ứng", async () => {
        const res = await api().get("/api/orders/kitchen-queue?station=bar").set(bearer(f.users.barista.token));
        expect(res.status).toBe(200);
        expect(res.body.data.every((l: any) => l.station === "bar")).toBe(true);
    });
});
