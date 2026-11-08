import { beforeAll, describe, expect, it } from "vitest";
import { syncReservationHolds } from "~/services/reservation.service";
import { api, auditRows, baseFixture, bearer, createDish, createTable, Fixture, q, settle } from "./helpers";

/** Giai đoạn 9: gộp / tách order, đổi trạng thái hàng loạt, combo chụp thành phần, tip, giữ bàn tự động */
let f: Fixture;
let food: number;
let drink: number;
let admin: { Authorization: string };

const MIN = 60_000;
const at = (minutes: number) => new Date(Math.round((Date.now() + minutes * MIN) / MIN) * MIN).toISOString();
const newTable = (name: string, capacity = 4) => createTable(f.rooms.hall, `${name}-${Math.random().toString(36).slice(2, 6)}`, capacity);

beforeAll(async () => {
    f = await baseFixture();
    admin = bearer(f.users.admin.token);
    food = await createDish("Bò lúc lắc", 120000, "food");
    drink = await createDish("Trà đào", 40000, "drink");
});

const open = async (tableIds: number[], token = f.users.waiter.token, guests = 2) => {
    const res = await api().post("/api/orders").set(bearer(token)).send({ table_ids: tableIds, guest_count: guests });
    expect(res.status).toBe(201);
    return res.body.data.id as number;
};
const round = (id: number, body: Record<string, unknown>, token = f.users.waiter.token) =>
    api().post(`/api/orders/${id}/rounds`).set(bearer(token)).send(body);
const detail = async (id: number) => (await api().get(`/api/orders/${id}`).set(admin)).body.data;
const lines = async (id: number) => (await detail(id)).rounds.flatMap((r: any) => r.lines);
const batch = (body: Record<string, unknown>, token: string) =>
    api().patch("/api/orders/lines/status").set(bearer(token)).send(body);

describe("Đổi trạng thái hàng loạt", () => {
    it("bếp nhận cả đợt chỉ đổi món của bếp; đồ uống giữ nguyên", async () => {
        const id = await open([await newTable("HL")]);
        const res = await round(id, { items: [{ dish_id: food, quantity: 2 }, { dish_id: drink, quantity: 1 }] });
        const roundId = res.body.data.rounds[0].id;
        const r = await batch({ round_id: roundId, station: "kitchen", status: "cooking" }, f.users.chef.token);
        expect(r.status).toBe(200);
        expect(r.body.data.lines).toHaveLength(1);
        const all = await lines(id);
        expect(all.find((l: any) => l.item_id === food).status).toBe("cooking");
        expect(all.find((l: any) => l.item_id === drink).status).toBe("pending");
        // Không còn món bếp nào chuyển được sang cooking
        expect((await batch({ round_id: roundId, station: "kitchen", status: "cooking" }, f.users.chef.token)).status).toBe(400);
    });

    it("danh sách món: một món không hợp lệ thì hủy cả lô; phục vụ tất cả món đã xong", async () => {
        const id = await open([await newTable("HL2")]);
        await round(id, { items: [{ dish_id: food, quantity: 1 }, { dish_id: drink, quantity: 1 }] });
        const [a, b] = await lines(id);
        const refs = [{ kind: "dish", id: a.id }, { kind: "dish", id: b.id }];
        // Chỉ món a xong -> phục vụ cả hai bị từ chối, a vẫn ở ready
        for (const s of ["cooking", "ready"]) await api().patch(`/api/orders/dishes/${a.id}/status`).set(admin).send({ status: s });
        expect((await batch({ lines: refs, status: "served" }, f.users.waiter.token)).status).toBe(400);
        expect((await lines(id)).find((l: any) => l.id === a.id).status).toBe("ready");
        // Phục vụ không có quyền chế biến
        expect((await batch({ lines: [refs[1]], status: "cooking" }, f.users.waiter.token)).status).toBe(403);
        for (const s of ["cooking", "ready"]) await api().patch(`/api/orders/dishes/${b.id}/status`).set(admin).send({ status: s });
        const ok = await batch({ lines: refs, status: "served" }, f.users.waiter.token);
        expect(ok.status).toBe(200);
        expect((await lines(id)).every((l: any) => l.status === "served")).toBe(true);
    });

    it("không đổi được món của chi nhánh khác; gửi cả lines và round_id bị từ chối", async () => {
        const id = await open([f.tables.x1], f.users.waiter2.token);
        await round(id, { items: [{ dish_id: food, quantity: 1 }] }, f.users.waiter2.token);
        const [line] = await lines(id);
        expect((await batch({ lines: [{ kind: "dish", id: line.id }], status: "cooking" }, f.users.chef.token)).status).toBe(404);
        expect((await batch({ lines: [{ kind: "dish", id: line.id }], round_id: 1, status: "cooking" }, f.users.chef.token)).status).toBe(400);
    });
});

describe("Combo chụp thành phần lúc gọi món", () => {
    it("đổi công thức combo không làm đổi combo đã gọi", async () => {
        const [combo] = await q<{ id: number }>("INSERT INTO combos (name, price) VALUES ('Combo trưa', 150000) RETURNING id");
        await q("INSERT INTO combo_items (combo_id, dish_id, quantity) VALUES ($1, $2, 1)", [combo.id, food]);
        const id = await open([await newTable("CB")]);
        await round(id, { combos: [{ combo_id: combo.id, quantity: 1 }] });
        await q("INSERT INTO combo_items (combo_id, dish_id, quantity) VALUES ($1, $2, 2)", [combo.id, drink]);
        const [line] = await lines(id);
        expect(line.combo_items).toEqual([{ dish_id: food, name: "Bò lúc lắc", quantity: 1 }]);
    });
});

describe("Gộp order", () => {
    it("gộp: món, đợt, bàn, số khách chuyển sang order đích; order nguồn thành merged", async () => {
        const tA = await newTable("GA");
        const tB = await newTable("GB");
        const a = await open([tA], f.users.waiter.token, 2);
        const b = await open([tB], f.users.waiter.token, 3);
        await round(a, { items: [{ dish_id: food, quantity: 1 }] });
        await round(b, { items: [{ dish_id: drink, quantity: 2 }] });
        await round(b, { items: [{ dish_id: drink, quantity: 1 }] });

        const res = await api().post(`/api/orders/${a}/merge`).set(bearer(f.users.waiter.token)).send({ target_order_id: b });
        expect(res.status).toBe(200);
        const target = res.body.data;
        expect(target.id).toBe(b);
        expect(target.guest_count).toBe(5);
        expect(target.rounds.map((r: any) => r.round_no)).toEqual([1, 2, 3]);
        expect(Number(target.subtotal)).toBe(120000 + 3 * 40000);
        expect(target.tables.map((t: any) => t.id).sort()).toEqual([tA, tB].sort());

        const source = await detail(a);
        expect(source.status).toBe("merged");
        expect(source.merged_into_order_id).toBe(b);
        expect(source.merged_into_code).toBe(target.code);
        expect(Number(source.total)).toBe(0);
        const [table] = await q("SELECT status FROM tables WHERE id = $1", [tA]);
        expect(table.status).toBe("occupied");
        expect((await auditRows("order.merge")).length).toBe(1);
        // Order đã gộp không thao tác tiếp được
        expect((await round(a, { items: [{ dish_id: food, quantity: 1 }] })).status).toBe(400);
    });

    it("không gộp order đã thu tiền, order chi nhánh khác, hoặc vào chính nó", async () => {
        const a = await open([await newTable("GC")]);
        const b = await open([await newTable("GD")]);
        await round(a, { items: [{ dish_id: drink, quantity: 1 }] });
        await api().post(`/api/orders/${a}/payments`).set(bearer(f.users.cashier.token)).send({ method: "cash", amount: 10000 });
        const merge = (src: number, target: number, token = f.users.waiter.token) =>
            api().post(`/api/orders/${src}/merge`).set(bearer(token)).send({ target_order_id: target });
        expect((await merge(a, b)).status).toBe(400);
        expect((await merge(b, b)).status).toBe(400);
        const other = await open([f.tables.x2], f.users.waiter2.token);
        expect((await merge(b, other)).status).toBe(404);
    });

    it("gộp hai chiều cùng lúc (A→B và B→A): đúng một lần thành công, không deadlock", async () => {
        const a = await open([await newTable("GX1")]);
        const b = await open([await newTable("GX2")]);
        const results = await Promise.all([
            api().post(`/api/orders/${a}/merge`).set(admin).send({ target_order_id: b }),
            api().post(`/api/orders/${b}/merge`).set(admin).send({ target_order_id: a }),
        ]);
        expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
        const rows = await q("SELECT status FROM orders WHERE id = ANY($1) ORDER BY id", [[a, b]]);
        expect(rows.map((r: any) => r.status).sort()).toEqual(["confirmed", "merged"]);
    });

    it("đặt bàn của order nguồn đi theo order đích", async () => {
        const tA = await newTable("GR1");
        const tB = await newTable("GR2");
        const r = await api()
            .post("/api/reservations")
            .set(bearer(f.users.receptionist.token))
            .send({ contact_name: "Khách G", contact_phone: "0909000111", guest_count: 2, start_time: at(0), end_time: at(90), table_ids: [tA] });
        expect(r.status).toBe(201);
        await api().patch(`/api/reservations/${r.body.data.id}/status`).set(bearer(f.users.receptionist.token)).send({ status: "arrived" });
        const [{ id: a }] = await q("SELECT id FROM orders WHERE reservation_id = $1", [r.body.data.id]);
        const b = await open([tB]);
        expect((await api().post(`/api/orders/${a}/merge`).set(admin).send({ target_order_id: b })).status).toBe(200);
        const [moved] = await q("SELECT reservation_id FROM orders WHERE id = $1", [b]);
        expect(moved.reservation_id).toBe(r.body.data.id);
    });
});

describe("Tách order", () => {
    it("tách một phần số lượng sang order mới trên bàn trống; giữ trạng thái và giờ gửi bếp", async () => {
        const tA = await newTable("TA");
        const tNew = await newTable("TN");
        const a = await open([tA]);
        await round(a, { items: [{ dish_id: food, quantity: 3 }] });
        const [line] = await lines(a);
        await api().patch(`/api/orders/dishes/${line.id}/status`).set(admin).send({ status: "cooking" });

        const res = await api()
            .post(`/api/orders/${a}/split`)
            .set(bearer(f.users.waiter.token))
            .send({ lines: [{ kind: "dish", id: line.id, quantity: 1 }], table_ids: [tNew], guest_count: 1 });
        expect(res.status).toBe(200);
        const { source, target } = res.body.data;
        expect(source.rounds[0].lines[0].quantity).toBe(2);
        expect(Number(source.subtotal)).toBe(240000);
        const moved = target.rounds[0].lines[0];
        expect(moved.quantity).toBe(1);
        expect(moved.status).toBe("cooking");
        expect(target.status).toBe("serving");
        expect(Number(target.subtotal)).toBe(120000);
        expect(new Date(target.rounds[0].sent_at).getTime()).toBe(new Date(source.rounds[0].sent_at).getTime());
        expect(target.tables.map((t: any) => t.id)).toEqual([tNew]);
        expect((await auditRows("order.split")).length).toBeGreaterThanOrEqual(1);
    });

    it("tách nguyên dòng sang order có sẵn; lấy bàn của order nguồn cho order mới", async () => {
        const t1 = await newTable("TS1");
        const t2 = await newTable("TS2");
        const a = await open([t1, t2]);
        const b = await open([await newTable("TS3")]);
        await round(a, { items: [{ dish_id: food, quantity: 1 }, { dish_id: drink, quantity: 2 }] });
        const all = await lines(a);
        const drinkLine = all.find((l: any) => l.item_id === drink);
        const toExisting = await api()
            .post(`/api/orders/${a}/split`)
            .set(admin)
            .send({ lines: [{ kind: "dish", id: drinkLine.id, quantity: 2 }], target_order_id: b });
        expect(toExisting.status).toBe(200);
        expect(Number(toExisting.body.data.target.subtotal)).toBe(80000);

        const foodLine = all.find((l: any) => l.item_id === food);
        // Lấy cả hai bàn của order nguồn -> từ chối (order nguồn phải còn bàn)
        const all2 = await api()
            .post(`/api/orders/${a}/split`)
            .set(admin)
            .send({ lines: [{ kind: "dish", id: foodLine.id, quantity: 1 }], table_ids: [t1, t2] });
        expect(all2.status).toBe(400);
        const one = await api()
            .post(`/api/orders/${a}/split`)
            .set(admin)
            .send({ lines: [{ kind: "dish", id: foodLine.id, quantity: 1 }], table_ids: [t2] });
        expect(one.status).toBe(200);
        expect((await detail(a)).tables.map((t: any) => t.id)).toEqual([t1]);
    });

    it("số lượng vượt quá, món đã hủy, món của order khác đều bị từ chối", async () => {
        const a = await open([await newTable("TX1")]);
        const b = await open([await newTable("TX2")]);
        await round(a, { items: [{ dish_id: food, quantity: 1 }, { dish_id: drink, quantity: 1 }] });
        await round(b, { items: [{ dish_id: food, quantity: 1 }] });
        const [x, y] = await lines(a);
        const [z] = await lines(b);
        await api().patch(`/api/orders/dishes/${y.id}/status`).set(admin).send({ status: "cancelled" });
        const split = (ref: Record<string, unknown>) =>
            api().post(`/api/orders/${a}/split`).set(admin).send({ lines: [ref], target_order_id: b });
        expect((await split({ kind: "dish", id: x.id, quantity: 2 })).status).toBe(400);
        expect((await split({ kind: "dish", id: y.id, quantity: 1 })).status).toBe(400);
        expect((await split({ kind: "dish", id: z.id, quantity: 1 })).status).toBe(400);
    });
});

describe("Tiền tip", () => {
    it("tip ghi riêng, không vào số đã thu; tiền thối tính cả tip; báo cáo tip theo nhân viên", async () => {
        const id = await open([await newTable("TP")]);
        await round(id, { items: [{ dish_id: drink, quantity: 1 }] });
        const [line] = await lines(id);
        for (const s of ["cooking", "ready", "served"]) await api().patch(`/api/orders/dishes/${line.id}/status`).set(admin).send({ status: s });

        const cashier = bearer(f.users.cashier.token);
        const tooLow = await api()
            .post(`/api/orders/${id}/payments`)
            .set(cashier)
            .send({ method: "cash", amount: 40000, tip_amount: 10000, received_amount: 45000 });
        expect(tooLow.status).toBe(400);
        const paid = await api()
            .post(`/api/orders/${id}/payments`)
            .set(cashier)
            .send({ method: "cash", amount: 40000, tip_amount: 10000, received_amount: 60000 });
        expect(paid.status).toBe(201);
        expect(Number(paid.body.data.change_amount)).toBe(10000);
        expect(Number(paid.body.data.tip_amount)).toBe(10000);
        expect(paid.body.data.tip_staff_id).toBe(f.users.waiter.userId);

        const o = await detail(id);
        expect(o.status).toBe("completed");
        expect(Number(o.paid_amount)).toBe(40000);
        expect(Number(o.tip_amount)).toBe(10000);

        const report = await api().get("/api/reports/tips").set(bearer(f.users.manager.token));
        expect(report.status).toBe(200);
        expect(report.body.data.total).toBe(10000);
        expect(report.body.data.by_staff[0]).toMatchObject({ staff_id: f.users.waiter.userId, tip_total: 10000 });
        const list = await api().get("/api/payments").set(cashier).query({ order_id: id });
        expect(Number(list.body.data.summary.tips)).toBe(10000);
        expect(Number(list.body.data.summary.collected)).toBe(40000);
        // Manager chi nhánh 2 không thấy tip chi nhánh 1
        const other = await api().get("/api/reports/tips").set(bearer(f.users.manager2.token));
        expect(other.body.data.total).toBe(0);
    });

    it("nhân viên nhận tip phải thuộc nhà hàng", async () => {
        const id = await open([await newTable("TP2")]);
        await round(id, { items: [{ dish_id: drink, quantity: 1 }] });
        const res = await api()
            .post(`/api/orders/${id}/payments`)
            .set(bearer(f.users.cashier.token))
            .send({ method: "card", amount: 40000, tip_amount: 5000, tip_staff_id: f.users.waiter2.userId });
        expect(res.status).toBe(404);
    });
});

describe("Sửa mã giảm giá tính lại order đang mở", () => {
    it("tăng % giảm thì order đang áp mã được tính lại", async () => {
        const id = await open([await newTable("DC")]);
        await round(id, { items: [{ dish_id: food, quantity: 1 }] });
        const [d] = await q<{ id: number }>(
            "INSERT INTO discounts (code, name, restaurant_id, type, value) VALUES ('GIAM10', 'Giảm 10%', $1, 'percent', 10) RETURNING id",
            [f.r1],
        );
        expect((await api().post(`/api/orders/${id}/discount`).set(bearer(f.users.cashier.token)).send({ code: "giam10" })).status).toBe(200);
        expect(Number((await detail(id)).discount_amount)).toBe(12000);
        expect((await api().patch(`/api/discounts/${d.id}`).set(bearer(f.users.manager.token)).send({ value: 20 })).status).toBe(200);
        expect(Number((await detail(id)).discount_amount)).toBe(24000);
    });
});

describe("Giữ bàn trước giờ hẹn và tự đánh dấu không đến", () => {
    const reserve = (tableIds: number[], start: string, end: string) =>
        api()
            .post("/api/reservations")
            .set(bearer(f.users.receptionist.token))
            .send({ contact_name: "Khách H", contact_phone: "0909000222", guest_count: 2, start_time: start, end_time: end, table_ids: tableIds });
    const tableRow = async (id: number) => (await q("SELECT status, held_reservation_id FROM tables WHERE id = $1", [id]))[0];

    it("đặt bàn trong 30 phút tới thì bàn chuyển reserved; hủy thì trả bàn", async () => {
        const t = await newTable("H1");
        const r = await reserve([t], at(10), at(100));
        expect(r.status).toBe(201);
        expect(await tableRow(t)).toEqual({ status: "reserved", held_reservation_id: r.body.data.id });
        await api().patch(`/api/reservations/${r.body.data.id}/status`).set(bearer(f.users.receptionist.token)).send({ status: "cancelled" });
        expect(await tableRow(t)).toEqual({ status: "available", held_reservation_id: null });
    });

    it("đặt bàn còn xa chưa giữ; tắt cấu hình thì không giữ; bàn đặt tay không bị trả", async () => {
        const far = await newTable("H2");
        expect((await reserve([far], at(120), at(180))).status).toBe(201);
        expect((await tableRow(far)).status).toBe("available");

        const manual = await newTable("H3");
        await q("UPDATE tables SET status = 'reserved' WHERE id = $1", [manual]);
        await syncReservationHolds(f.r1);
        expect(await tableRow(manual)).toEqual({ status: "reserved", held_reservation_id: null });

        await q("UPDATE restaurants SET reservation_hold_minutes = 0 WHERE id = $1", [f.r1]);
        const off = await newTable("H4");
        expect((await reserve([off], at(5), at(60))).status).toBe(201);
        expect((await tableRow(off)).status).toBe("available");
        await q("UPDATE restaurants SET reservation_hold_minutes = 30 WHERE id = $1", [f.r1]);
    });

    it("khách đến trễ quá 15 phút: job đánh dấu no_show, ghi nhật ký và trả bàn", async () => {
        const t = await newTable("H5");
        const [r] = await q<{ id: number }>(
            `INSERT INTO reservations (restaurant_id, contact_name, contact_phone, guest_count, start_time, end_time, status)
            VALUES ($1, 'Khách trễ', '0909000333', 2, NOW() - interval '20 minutes', NOW() + interval '60 minutes', 'confirmed')
            RETURNING id`,
            [f.r1],
        );
        await q("INSERT INTO reservation_tables (reservation_id, table_id, period) VALUES ($1, $2, 'empty')", [r.id, t]);
        await q("UPDATE tables SET status = 'reserved', held_reservation_id = $1 WHERE id = $2", [r.id, t]);

        const result = await syncReservationHolds();
        expect(result.no_show).toBeGreaterThanOrEqual(1);
        const [row] = await q("SELECT status, cancelled_at FROM reservations WHERE id = $1", [r.id]);
        expect(row.status).toBe("no_show");
        expect(row.cancelled_at).toBeTruthy();
        expect(await tableRow(t)).toEqual({ status: "available", held_reservation_id: null });
        const audit = (await auditRows("reservation.auto_no_show")).find((a: any) => a.entity_id === r.id);
        expect(audit.actor_name).toBe("system");
    });

    it("khách đến: bàn chuyển occupied, bỏ liên kết giữ bàn", async () => {
        const t = await newTable("H6");
        const r = await reserve([t], at(5), at(60));
        expect((await tableRow(t)).status).toBe("reserved");
        await api().patch(`/api/reservations/${r.body.data.id}/status`).set(bearer(f.users.receptionist.token)).send({ status: "arrived" });
        expect(await tableRow(t)).toEqual({ status: "occupied", held_reservation_id: null });
    });

    it("cấu hình theo nhà hàng: 0–240 phút", async () => {
        const patch = (body: Record<string, unknown>) => api().patch(`/api/restaurants/${f.r1}`).set(admin).send(body);
        expect((await patch({ reservation_hold_minutes: 300 })).status).toBe(400);
        const ok = await patch({ reservation_hold_minutes: 45, no_show_after_minutes: 0 });
        expect(ok.status).toBe(200);
        expect(ok.body.data.reservation_hold_minutes).toBe(45);
        await patch({ reservation_hold_minutes: 30, no_show_after_minutes: 15 });
    });
});

describe("Tạm khóa phòng còn lịch đặt", () => {
    it("trả 409 khi còn lịch sắp tới; gửi kèm force thì tạm khóa được", async () => {
        const [room] = await q<{ id: number }>("INSERT INTO rooms (name, type, restaurant_id) VALUES ('Sân thượng', 'public', $1) RETURNING id", [f.r1]);
        const t = await createTable(room.id, "ST1");
        const r = await api()
            .post("/api/reservations")
            .set(bearer(f.users.receptionist.token))
            .send({ contact_name: "Khách P", contact_phone: "0909000444", guest_count: 2, start_time: at(600), end_time: at(660), table_ids: [t] });
        expect(r.status).toBe(201);
        const patch = (body: Record<string, unknown>) => api().patch(`/api/rooms/${room.id}`).set(bearer(f.users.manager.token)).send(body);
        expect((await patch({ is_active: false })).status).toBe(409);
        expect((await patch({ force: true })).status).toBe(400); // force không phải là thay đổi
        const ok = await patch({ is_active: false, force: true });
        expect(ok.status).toBe(200);
        expect(ok.body.data.is_active).toBe(false);
    });
});

describe("Sắp xếp ảnh", () => {
    it("lưu thứ tự mới; danh sách thiếu ảnh bị từ chối", async () => {
        const ids = (
            await q<{ id: number }>(
                `INSERT INTO images (url, public_id, entity_type, entity_id, sort_order, is_primary)
                VALUES ('u1', NULL, 'dish', $1, 0, true), ('u2', NULL, 'dish', $1, 1, false), ('u3', NULL, 'dish', $1, 2, false)
                RETURNING id`,
                [food],
            )
        ).map((r) => r.id);
        const put = (imageIds: number[]) =>
            api().put("/api/images/order").set(admin).send({ entity_type: "dish", entity_id: food, image_ids: imageIds });
        const res = await put([ids[2], ids[0], ids[1]]);
        expect(res.status).toBe(200);
        expect(res.body.data.map((i: any) => i.id)).toEqual([ids[2], ids[0], ids[1]]);
        expect(res.body.data[1].is_primary).toBe(true);
        expect((await put([ids[0], ids[1]])).status).toBe(400);
        // Phục vụ không có quyền sửa món
        const waiter = await api()
            .put("/api/images/order")
            .set(bearer(f.users.waiter.token))
            .send({ entity_type: "dish", entity_id: food, image_ids: ids });
        expect(waiter.status).toBe(403);
        await settle();
    });
});
