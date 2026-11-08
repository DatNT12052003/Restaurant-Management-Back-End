import { beforeAll, describe, expect, it } from "vitest";
import {
    api,
    auditRows,
    baseFixture,
    bearer,
    createDish,
    createIngredient,
    createRestaurant,
    createRoom,
    createTable,
    Fixture,
    q,
} from "./helpers";

/** Giai đoạn 10: định lượng món, tự trừ kho khi phục vụ, giá vốn, lợi nhuận, hao hụt, ngày nghỉ, cơ sở doanh thu */
let f: Fixture;
let admin: { Authorization: string };
let beef: number;
let rice: number;
let steak: number;
let friedRice: number;
let water: number;

beforeAll(async () => {
    f = await baseFixture();
    admin = bearer(f.users.admin.token);
    beef = await createIngredient("Thịt bò", "kg");
    rice = await createIngredient("Gạo", "kg");
    steak = await createDish("Bít tết", 250000);
    friedRice = await createDish("Cơm chiên", 60000);
    water = await createDish("Nước suối", 15000, "drink");
    // Nhập kho chi nhánh 1: 10 kg bò giá 200.000, 5 kg gạo giá 20.000
    const res = await api()
        .post("/api/inventory/receipts")
        .set(admin)
        .send({
            type: "import",
            restaurant_id: f.r1,
            lines: [
                { ingredient_id: beef, quantity: 10, unit_price: 200000 },
                { ingredient_id: rice, quantity: 5, unit_price: 20000 },
            ],
        });
    expect(res.status).toBe(201);
});

const setRecipe = (dishId: number, items: { ingredient_id: number; quantity: number }[], token = f.users.chef.token) =>
    api().put(`/api/recipes/dishes/${dishId}`).set(bearer(token)).send({ items });
const stock = async (ingredientId: number, restaurantId = f.r1) =>
    Number((await q("SELECT quantity FROM inventory WHERE restaurant_id = $1 AND ingredient_id = $2", [restaurantId, ingredientId]))[0]?.quantity ?? 0);
const newTable = () => createTable(f.rooms.hall, `RC-${Math.random().toString(36).slice(2, 7)}`);

/** Mở order, gọi món, đưa tới `ready` để sẵn sàng phục vụ */
const readyOrder = async (items: { dish_id: number; quantity: number }[], combos: { combo_id: number; quantity: number }[] = []) => {
    const id = (await api().post("/api/orders").set(admin).send({ restaurant_id: f.r1, table_ids: [await newTable()], guest_count: 2 })).body.data.id;
    await api().post(`/api/orders/${id}/rounds`).set(admin).send({ items, combos });
    const detail = (await api().get(`/api/orders/${id}`).set(admin)).body.data;
    const lines = detail.rounds.flatMap((r: any) => r.lines);
    for (const line of lines) {
        const path = line.kind === "dish" ? "dishes" : "combos";
        for (const s of ["cooking", "ready"]) await api().patch(`/api/orders/${path}/${line.id}/status`).set(admin).send({ status: s });
    }
    return { id: id as number, lines };
};
const serve = (line: { kind: string; id: number }, token = f.users.waiter.token) =>
    api()
        .patch(`/api/orders/${line.kind === "dish" ? "dishes" : "combos"}/${line.id}/status`)
        .set(bearer(token))
        .send({ status: "served" });
const lineCost = async (kind: string, id: number) =>
    (await q(`SELECT cost FROM ${kind === "dish" ? "order_items" : "order_combos"} WHERE id = $1`, [id]))[0].cost;

describe("Định lượng món", () => {
    it("bếp trưởng sửa; quản lý chỉ xem; phục vụ không xem được; có ghi nhật ký", async () => {
        const res = await setRecipe(steak, [{ ingredient_id: beef, quantity: 0.25 }]);
        expect(res.status).toBe(200);
        expect(res.body.data.items).toHaveLength(1);
        // 0,25 kg × 200.000 = 50.000 trên giá 250.000 -> 20%
        expect(res.body.data.cost).toBe(50000);
        expect(res.body.data.food_cost_rate).toBe(0.2);

        expect((await api().get(`/api/recipes/dishes/${steak}`).set(bearer(f.users.manager.token))).status).toBe(200);
        expect((await setRecipe(steak, [], f.users.manager.token)).status).toBe(403);
        expect((await api().get(`/api/recipes/dishes/${steak}`).set(bearer(f.users.waiter.token))).status).toBe(403);
        expect((await auditRows("dish.recipe_update")).length).toBe(1);
    });

    it("trùng nguyên liệu, định lượng ≤ 0, nguyên liệu không tồn tại đều bị từ chối", async () => {
        expect((await setRecipe(friedRice, [{ ingredient_id: rice, quantity: 0.1 }, { ingredient_id: rice, quantity: 0.2 }])).status).toBe(400);
        expect((await setRecipe(friedRice, [{ ingredient_id: rice, quantity: 0 }])).status).toBe(400);
        expect((await setRecipe(friedRice, [{ ingredient_id: 999999, quantity: 1 }])).status).toBe(400);
        expect((await setRecipe(friedRice, [{ ingredient_id: rice, quantity: 0.2 }, { ingredient_id: beef, quantity: 0.05 }])).status).toBe(200);
    });

    it("không xóa được nguyên liệu đang có trong định lượng", async () => {
        const salt = await createIngredient("Muối", "kg");
        await setRecipe(water, [{ ingredient_id: salt, quantity: 0.001 }]);
        expect((await api().delete(`/api/ingredients/${salt}`).set(admin)).status).toBe(400);
        await setRecipe(water, []);
        expect((await api().delete(`/api/ingredients/${salt}`).set(admin)).status).toBe(200);
    });
});

describe("Tự trừ kho khi phục vụ", () => {
    it("phục vụ món: trừ kho theo định lượng × số phần, ghi giao dịch consume và giá vốn của dòng", async () => {
        const before = await stock(beef);
        const { lines } = await readyOrder([{ dish_id: steak, quantity: 2 }, { dish_id: water, quantity: 1 }]);
        const steakLine = lines.find((l: any) => l.item_id === steak);
        const waterLine = lines.find((l: any) => l.item_id === water);
        expect((await serve(steakLine)).status).toBe(200);
        expect((await serve(waterLine)).status).toBe(200);

        expect(await stock(beef)).toBeCloseTo(before - 0.5, 3);
        expect(Number(await lineCost("dish", steakLine.id))).toBe(100000);
        // Món chưa có định lượng: không có giá vốn, không trừ kho
        expect(await lineCost("dish", waterLine.id)).toBeNull();
        const txns = await q("SELECT * FROM inventory_transactions WHERE type = 'consume' AND reference_id = $1", [steakLine.id]);
        expect(txns).toHaveLength(1);
        expect(txns[0].reference_type).toBe("order_item");
        expect(Number(txns[0].quantity_change)).toBe(-0.5);
        expect(Number(txns[0].unit_price)).toBe(200000);
    });

    it("phục vụ tất cả (hàng loạt) trừ kho cho cả lô; combo trừ theo các món bên trong", async () => {
        const [combo] = await q<{ id: number }>("INSERT INTO combos (name, price) VALUES ('Combo bò', 300000) RETURNING id");
        await q("INSERT INTO combo_items (combo_id, dish_id, quantity) VALUES ($1, $2, 1), ($1, $3, 1)", [combo.id, steak, friedRice]);
        const beefBefore = await stock(beef);
        const riceBefore = await stock(rice);
        const { lines } = await readyOrder([{ dish_id: friedRice, quantity: 1 }], [{ combo_id: combo.id, quantity: 2 }]);
        const res = await api()
            .patch("/api/orders/lines/status")
            .set(bearer(f.users.waiter.token))
            .send({ status: "served", lines: lines.map((l: any) => ({ kind: l.kind, id: l.id })) });
        expect(res.status).toBe(200);
        // Cơm chiên ×1: gạo 0,2, bò 0,05. Combo ×2: (bít tết 0,25 bò) + (cơm chiên 0,2 gạo + 0,05 bò) mỗi combo
        expect(await stock(beef)).toBeCloseTo(beefBefore - 0.05 - 2 * 0.3, 3);
        expect(await stock(rice)).toBeCloseTo(riceBefore - 0.2 - 2 * 0.2, 3);
        const comboLine = lines.find((l: any) => l.kind === "combo");
        // 2 × (0,3 kg bò × 200.000 + 0,2 kg gạo × 20.000) = 128.000
        expect(Number(await lineCost("combo", comboLine.id))).toBe(128000);
    });

    it("thiếu kho vẫn phục vụ được, tồn xuống âm và tính là tồn thấp; nhập lại thì giá bình quân tính trên phần dương", async () => {
        const truffle = await createIngredient("Nấm truffle", "g");
        await api().post("/api/inventory/receipts").set(admin).send({
            type: "import",
            restaurant_id: f.r1,
            lines: [{ ingredient_id: truffle, quantity: 10, unit_price: 5000 }],
        });
        const special = await createDish("Mì truffle", 400000);
        await setRecipe(special, [{ ingredient_id: truffle, quantity: 15 }]);
        const { lines } = await readyOrder([{ dish_id: special, quantity: 1 }]);
        expect((await serve(lines[0])).status).toBe(200);
        expect(await stock(truffle)).toBe(-5);

        const inv = await api().get("/api/inventory").set(admin).query({ restaurant_id: f.r1, low_only: true });
        expect(inv.body.data.items.some((i: any) => i.ingredient_id === truffle)).toBe(true);
        // Phiếu xuất tay vẫn không được vượt tồn
        const exp = await api().post("/api/inventory/receipts").set(admin).send({
            type: "export",
            restaurant_id: f.r1,
            reason: "Hỏng",
            lines: [{ ingredient_id: truffle, quantity: 1 }],
        });
        expect(exp.status).toBe(400);
        await api().post("/api/inventory/receipts").set(admin).send({
            type: "import",
            restaurant_id: f.r1,
            lines: [{ ingredient_id: truffle, quantity: 20, unit_price: 6000 }],
        });
        const [row] = await q("SELECT quantity, avg_unit_cost FROM inventory WHERE restaurant_id = $1 AND ingredient_id = $2", [f.r1, truffle]);
        expect(Number(row.quantity)).toBe(15);
        expect(Number(row.avg_unit_cost)).toBe(6000);
    });

    it("tách một phần dòng đã phục vụ: giá vốn chia theo số lượng", async () => {
        const { id, lines } = await readyOrder([{ dish_id: steak, quantity: 3 }]);
        await serve(lines[0]);
        expect(Number(await lineCost("dish", lines[0].id))).toBe(150000);
        const res = await api()
            .post(`/api/orders/${id}/split`)
            .set(admin)
            .send({ lines: [{ kind: "dish", id: lines[0].id, quantity: 1 }], table_ids: [await newTable()] });
        expect(res.status).toBe(200);
        const moved = res.body.data.target.rounds[0].lines[0];
        expect(Number(await lineCost("dish", moved.id))).toBe(50000);
        expect(Number(await lineCost("dish", lines[0].id))).toBe(100000);
    });
});

describe("Bảng giá vốn", () => {
    it("giá vốn món, combo; món thiếu định lượng; giá riêng chi nhánh", async () => {
        await q("INSERT INTO restaurant_dishes (restaurant_id, dish_id, is_available, price) VALUES ($1, $2, true, 200000)", [f.r1, steak]);
        const res = await api().get("/api/recipes").set(bearer(f.users.manager.token));
        expect(res.status).toBe(200);
        expect(res.body.data.restaurant_id).toBe(f.r1);
        const steakRow = res.body.data.items.find((i: any) => i.kind === "dish" && i.id === steak);
        expect(steakRow.price).toBe(200000);
        expect(steakRow.cost).toBe(50000);
        expect(steakRow.food_cost_rate).toBe(0.25);
        const waterRow = res.body.data.items.find((i: any) => i.kind === "dish" && i.id === water);
        expect(waterRow.cost).toBeNull();
        expect(res.body.data.summary.missing_recipe).toBeGreaterThanOrEqual(1);
        const combo = res.body.data.items.find((i: any) => i.kind === "combo");
        expect(combo.cost).toBeCloseTo(50000 + 0.2 * 20000 + 0.05 * 200000, 2);
        // Phục vụ không có quyền xem giá vốn
        expect((await api().get("/api/recipes").set(bearer(f.users.waiter.token))).status).toBe(403);
    });
});

describe("Báo cáo lợi nhuận và hao hụt", () => {
    it("lãi gộp: doanh số, giá vốn, tỷ lệ food cost, doanh số món chưa có định lượng", async () => {
        const res = await api().get("/api/reports/profit").set(bearer(f.users.manager.token));
        expect(res.status).toBe(200);
        const t = res.body.data.totals;
        expect(t.sales).toBeGreaterThan(0);
        expect(t.cost).toBeGreaterThan(0);
        expect(t.gross_profit).toBeCloseTo(t.sales - t.cost, 2);
        expect(t.uncosted_sales).toBeGreaterThanOrEqual(15000);
        const steakRow = res.body.data.by_item.find((i: any) => i.kind === "dish" && i.item_id === steak);
        expect(steakRow.food_cost_rate).toBe(0.2);
        expect(res.body.data.by_category.map((c: any) => c.category)).toEqual(expect.arrayContaining(["food", "drink", "combo"]));
        // Chi nhánh 2 chưa phục vụ món nào
        const other = await api().get("/api/reports/profit").set(bearer(f.users.manager2.token));
        expect(other.body.data.totals.sales).toBe(0);
    });

    it("hao hụt: kiểm kê âm so với tiêu hao lý thuyết", async () => {
        const current = await stock(rice);
        const res = await api()
            .post("/api/inventory/receipts")
            .set(admin)
            .send({ type: "adjust", restaurant_id: f.r1, reason: "Kiểm kê cuối ngày", lines: [{ ingredient_id: rice, quantity: current - 0.3 }] });
        expect(res.status).toBe(201);
        const report = await api().get("/api/reports/ingredient-variance").set(bearer(f.users.manager.token));
        expect(report.status).toBe(200);
        const row = report.body.data.items.find((i: any) => i.ingredient_id === rice);
        // Gạo đã tiêu hao: cơm chiên ×1 (0,2) + combo ×2 (0,4)
        expect(row.consumed).toBeCloseTo(0.6, 3);
        expect(row.adjusted).toBeCloseTo(-0.3, 3);
        expect(row.loss_rate).toBeCloseTo(0.5, 4);
        expect(report.body.data.totals.loss_value).toBeLessThan(0);
    });
});

describe("Cơ sở doanh thu", () => {
    it("paid theo thời điểm thanh toán; completed theo thời điểm hoàn tất order", async () => {
        const r3 = await createRestaurant("Nhà hàng Ba");
        const [o] = await q<{ id: number }>(
            `INSERT INTO orders (code, restaurant_id, status, total, completed_at)
            VALUES ('R3-TEST-0001', $1, 'completed', 100000, NOW()) RETURNING id`,
            [r3],
        );
        // Thu tiền từ 3 ngày trước, order hoàn tất hôm nay
        await q(
            `INSERT INTO payments (order_id, restaurant_id, type, method, amount, status, paid_at)
            VALUES ($1, $2, 'payment', 'cash', 100000, 'paid', NOW() - interval '3 days')`,
            [o.id, r3],
        );
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
        const get = (basis: string) =>
            api().get("/api/reports/revenue").set(admin).query({ restaurant_id: r3, from: today, to: today, basis });
        expect((await get("paid")).body.data.totals.net).toBe(0);
        const completed = await get("completed");
        expect(completed.body.data.basis).toBe("completed");
        expect(completed.body.data.totals.net).toBe(100000);
        expect(completed.body.data.totals.orders).toBe(1);
        expect((await get("other")).status).toBe(400);
    });
});

describe("Lấp đầy bàn: giờ mở cửa và ngày nghỉ", () => {
    it("chỉ tính giờ có khách trong giờ mở cửa; ngày nghỉ không tính giờ mở cửa", async () => {
        const r4 = await createRestaurant("Nhà hàng Bốn", { open_time: "08:00", close_time: "22:00" });
        const room = await createRoom(r4, "Sảnh 4");
        const table = await createTable(room, "D1");
        const [o] = await q<{ id: number }>(
            "INSERT INTO orders (code, restaurant_id, status) VALUES ('R4-TEST-0001', $1, 'completed') RETURNING id",
            [r4],
        );
        const day = "2026-01-10";
        const at = (time: string) => `${day} ${time}+07`;
        // 10:00–12:00 trong giờ; 21:30–23:00 thì 0,5 giờ trong giờ, 1 giờ ngoài giờ
        await q(
            `INSERT INTO order_tables (order_id, table_id, assigned_at, released_at)
            VALUES ($1, $2, $3, $4), ($1, $2, $5, $6)`,
            [o.id, table, at("10:00"), at("12:00"), at("21:30"), at("23:00")],
        );
        const get = () => api().get("/api/reports/table-occupancy").set(admin).query({ restaurant_id: r4, from: day, to: day });
        const open = (await get()).body.data;
        expect(open.summary.occupied_hours).toBeCloseTo(2.5, 2);
        expect(open.summary.outside_hours).toBeCloseTo(1, 2);
        expect(open.summary.available_hours).toBeCloseTo(14, 2);
        expect(open.summary.occupancy_rate).toBeCloseTo(2.5 / 14, 4);

        // Đánh dấu ngày nghỉ qua API: mọi giờ có khách thành ngoài giờ, không có giờ mở cửa
        expect((await api().post(`/api/restaurants/${r4}/closed-days`).set(admin).send({ day, note: "Sửa chữa" })).status).toBe(201);
        const closed = (await get()).body.data;
        expect(closed.closed_days).toBe(1);
        expect(closed.summary.available_hours).toBe(0);
        expect(closed.summary.occupied_hours).toBe(0);
        expect(closed.summary.outside_hours).toBeCloseTo(3.5, 2);
        expect(closed.summary.occupancy_rate).toBeNull();
    });

    it("ngày nghỉ: quản lý thêm / xóa cho chi nhánh mình; trùng ngày, chi nhánh khác bị từ chối", async () => {
        const manager = bearer(f.users.manager.token);
        const add = (restaurantId: number, day: string) =>
            api().post(`/api/restaurants/${restaurantId}/closed-days`).set(manager).send({ day });
        expect((await add(f.r1, "2026-02-17")).status).toBe(201);
        expect((await add(f.r1, "2026-02-17")).status).toBe(400);
        expect((await add(f.r2, "2026-02-17")).status).toBe(403);
        expect((await add(f.r1, "2026-02-30")).status).toBe(400);
        const list = await api().get(`/api/restaurants/${f.r1}/closed-days`).set(manager);
        expect(list.body.data.map((d: any) => d.day)).toContain("2026-02-17");
        expect((await api().delete(`/api/restaurants/${f.r1}/closed-days/2026-02-17`).set(manager)).status).toBe(200);
        expect((await api().delete(`/api/restaurants/${f.r1}/closed-days/2026-02-17`).set(manager)).status).toBe(404);
        // Phục vụ không có quyền sửa nhà hàng / phòng
        expect((await api().post(`/api/restaurants/${f.r1}/closed-days`).set(bearer(f.users.waiter.token)).send({ day: "2026-03-01" })).status).toBe(403);
    });
});

describe("Danh sách nhà hàng", () => {
    it("trả cả cấu hình (phí, thuế, giờ mở cửa, giữ bàn) để form sửa không ghi đè bằng giá trị mặc định", async () => {
        await q("UPDATE restaurants SET tax_percent = 8, open_time = '09:00', reservation_hold_minutes = 45 WHERE id = $1", [f.r1]);
        const res = await api().get("/api/restaurants").set(admin);
        expect(res.status).toBe(200);
        const r1 = res.body.data.restaurants.find((r: any) => r.id === f.r1);
        expect(Number(r1.tax_percent)).toBe(8);
        expect(r1.open_time).toMatch(/^09:00/);
        expect(r1.reservation_hold_minutes).toBe(45);
    });
});
