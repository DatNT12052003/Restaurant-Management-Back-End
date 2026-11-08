import { beforeAll, describe, expect, it } from "vitest";
import { api, auditRows, baseFixture, bearer, createDish, createIngredient, createTable, Fixture, q } from "./helpers";

/** Giai đoạn 11: nhà cung cấp, đơn đặt hàng, lô hàng FEFO, hủy hàng, chuyển kho, công nợ */
let f: Fixture;
let admin: { Authorization: string };
let manager: { Authorization: string };
let manager2: { Authorization: string };
let milk: number; // theo dõi hạn dùng
let sugar: number; // không theo dõi

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
const plusDays = (days: number) => new Date(Date.parse(`${today()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
    f = await baseFixture();
    admin = bearer(f.users.admin.token);
    manager = bearer(f.users.manager.token);
    manager2 = bearer(f.users.manager2.token);
    milk = await createIngredient("Sữa tươi", "l");
    sugar = await createIngredient("Đường", "kg");
    await q("UPDATE ingredients SET track_expiry = true, shelf_life_days = 7 WHERE id = $1", [milk]);
});

const stock = async (ingredientId: number, restaurantId: number) => {
    const [row] = await q("SELECT quantity, avg_unit_cost FROM inventory WHERE restaurant_id = $1 AND ingredient_id = $2", [restaurantId, ingredientId]);
    return { qty: Number(row?.quantity ?? 0), avg: Number(row?.avg_unit_cost ?? 0) };
};
const lots = (restaurantId: number, ingredientId: number) =>
    q(
        "SELECT lot_code, to_char(expiry_date, 'YYYY-MM-DD') AS expiry_date, quantity::float AS quantity FROM inventory_lots WHERE restaurant_id = $1 AND ingredient_id = $2 ORDER BY expiry_date, id",
        [restaurantId, ingredientId],
    );
const receipt = (token: { Authorization: string }, body: Record<string, unknown>) => api().post("/api/inventory/receipts").set(token).send(body);

let supplierId: number;

describe("Nhà cung cấp", () => {
    it("quản lý thêm, sửa, đặt bảng giá; bếp trưởng chỉ xem; trùng tên bị từ chối", async () => {
        const res = await api().post("/api/suppliers").set(manager).send({ name: "Công ty Sữa Sạch", phone: "0281234567", payment_terms_days: 15 });
        expect(res.status).toBe(201);
        supplierId = res.body.data.id;
        expect((await api().post("/api/suppliers").set(manager).send({ name: "công ty sữa sạch" })).status).toBe(400);
        expect((await api().post("/api/suppliers").set(bearer(f.users.chef.token)).send({ name: "NCC khác" })).status).toBe(403);
        expect((await api().get("/api/suppliers").set(bearer(f.users.chef.token))).status).toBe(200);

        const prices = await api()
            .put(`/api/suppliers/${supplierId}/prices`)
            .set(manager)
            .send({ items: [{ ingredient_id: milk, unit_price: 30000, is_preferred: true }, { ingredient_id: sugar, unit_price: 20000 }] });
        expect(prices.status).toBe(200);
        expect(prices.body.data).toHaveLength(2);
        const byIngredient = await api().get(`/api/suppliers/ingredients/${milk}/prices`).set(manager);
        expect(byIngredient.body.data[0]).toMatchObject({ supplier_id: supplierId, supplier_name: "Công ty Sữa Sạch" });
    });
});

describe("Đơn đặt hàng và công nợ", () => {
    let orderId: number;

    it("lập nháp (giá theo bảng giá), sửa, gửi; phạm vi chi nhánh", async () => {
        const res = await api()
            .post("/api/purchase-orders")
            .set(manager)
            .send({ supplier_id: supplierId, lines: [{ ingredient_id: milk, quantity: 10 }, { ingredient_id: sugar, quantity: 5, unit_price: 19000 }] });
        expect(res.status).toBe(201);
        orderId = res.body.data.id;
        expect(res.body.data.code).toMatch(/^DH-R\d+-\d{8}-\d{3}$/);
        expect(res.body.data.status).toBe("draft");
        expect(res.body.data.restaurant_id).toBe(f.r1);
        expect(Number(res.body.data.total)).toBe(10 * 30000 + 5 * 19000);
        expect(Number(res.body.data.lines.find((l: any) => l.ingredient_id === milk).unit_price)).toBe(30000);

        const upd = await api().patch(`/api/purchase-orders/${orderId}`).set(manager).send({ note: "Giao trước 9h" });
        expect(upd.status).toBe(200);
        expect((await api().post(`/api/purchase-orders/${orderId}/send`).set(manager)).status).toBe(200);
        // Đã gửi thì không sửa được nữa
        expect((await api().patch(`/api/purchase-orders/${orderId}`).set(manager).send({ note: "x" })).status).toBe(400);
        // Chi nhánh khác không thấy đơn
        expect((await api().get(`/api/purchase-orders/${orderId}`).set(manager2)).status).toBe(404);
    });

    it("nhận một phần: bắt buộc hạn dùng với nguyên liệu theo lô; tạo phiếu nhập, lô, khoản phải trả", async () => {
        const detail = (await api().get(`/api/purchase-orders/${orderId}`).set(manager)).body.data;
        const milkLine = detail.lines.find((l: any) => l.ingredient_id === milk);
        const sugarLine = detail.lines.find((l: any) => l.ingredient_id === sugar);
        const receive = (lines: unknown[]) =>
            api().post(`/api/purchase-orders/${orderId}/receive`).set(bearer(f.users.sousChef.token)).send({ lines });
        expect((await receive([{ line_id: milkLine.id, quantity: 6 }])).status).toBe(400);

        const res = await receive([{ line_id: milkLine.id, quantity: 6, unit_price: 32000, expiry_date: plusDays(5), lot_code: "L01" }]);
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("partial");
        expect(res.body.data.receipts).toHaveLength(1);
        expect(await stock(milk, f.r1)).toEqual({ qty: 6, avg: 32000 });
        expect(await lots(f.r1, milk)).toEqual([{ lot_code: "L01", expiry_date: plusDays(5), quantity: 6 }]);
        // Giá mới nhất của nhà cung cấp được cập nhật
        const [price] = await q("SELECT unit_price FROM supplier_ingredients WHERE supplier_id = $1 AND ingredient_id = $2", [supplierId, milk]);
        expect(Number(price.unit_price)).toBe(32000);

        const bills = await api().get("/api/payables").set(manager);
        expect(bills.status).toBe(200);
        expect(bills.body.data.bills).toHaveLength(1);
        expect(bills.body.data.bills[0]).toMatchObject({ supplier_id: supplierId, due_date: plusDays(15), status: "unpaid" });
        expect(Number(bills.body.data.bills[0].amount)).toBe(6 * 32000);

        // Đã nhận một phần: không hủy được
        expect((await api().post(`/api/purchase-orders/${orderId}/cancel`).set(manager).send({})).status).toBe(400);

        const rest = await receive([
            { line_id: milkLine.id, quantity: 4, expiry_date: plusDays(6) },
            { line_id: sugarLine.id, quantity: 5 },
        ]);
        expect(rest.body.data.status).toBe("received");
        expect((await stock(sugar, f.r1)).qty).toBe(5);
        // Không ghi giá khi nhận thì lấy giá trên đơn
        expect(Number(rest.body.data.received_value)).toBe(6 * 32000 + 4 * 30000 + 5 * 19000);
    });

    it("đóng đơn còn thiếu; hủy đơn nháp; không xóa nhà cung cấp còn công nợ", async () => {
        const create = (send: boolean) =>
            api().post("/api/purchase-orders").set(manager).send({ supplier_id: supplierId, send, lines: [{ ingredient_id: sugar, quantity: 10 }] });
        const partial = (await create(true)).body.data;
        await api()
            .post(`/api/purchase-orders/${partial.id}/receive`)
            .set(manager)
            // Giao diện gửi expiry_date / lot_code = null cho nguyên liệu không theo lô
            .send({ lines: [{ line_id: partial.lines[0].id, quantity: 4, expiry_date: null, lot_code: null }] });
        expect((await api().get(`/api/purchase-orders/${partial.id}`).set(manager)).body.data.status).toBe("partial");
        const closed = await api().post(`/api/purchase-orders/${partial.id}/close`).set(manager).send({ reason: "NCC hết hàng" });
        expect(closed.body.data.status).toBe("closed");
        const draft = (await create(false)).body.data;
        expect((await api().post(`/api/purchase-orders/${draft.id}/cancel`).set(manager).send({})).body.data.status).toBe("cancelled");
        expect((await auditRows("purchase_order.close")).length).toBe(1);
        expect((await api().delete(`/api/suppliers/${supplierId}`).set(manager)).status).toBe(400);
    });

    it("trả công nợ: một phần, vượt số nợ bị từ chối, trả hết; chi nhánh khác không trả được", async () => {
        const list = (await api().get("/api/payables").set(manager).query({ status: "unpaid" })).body.data;
        const bill = list.bills[0];
        const pay = (token: { Authorization: string }, amount: number) =>
            api().post(`/api/payables/${bill.id}/payments`).set(token).send({ amount, method: "transfer", reference: "UNC-001" });
        expect((await pay(manager2, 1000)).status).toBe(404);
        expect((await pay(bearer(f.users.chef.token), 1000)).status).toBe(403);
        const first = await pay(manager, 100000);
        expect(first.status).toBe(200);
        expect(first.body.data.status).toBe("partial");
        expect((await pay(manager, Number(bill.amount))).status).toBe(400);
        const done = await pay(manager, Number(bill.amount) - 100000);
        expect(done.body.data.status).toBe("paid");
        expect(done.body.data.payments).toHaveLength(2);
        expect((await pay(manager, 1)).status).toBe(400);
        expect((await auditRows("payable.pay")).length).toBe(2);
        const summary = (await api().get("/api/payables").set(manager)).body.data.summary;
        expect(Number(summary.outstanding)).toBeGreaterThan(0);
    });

    it("gợi ý đặt hàng: đủ dùng N ngày theo tiêu hao, cộng ngưỡng, trừ tồn và hàng đang về", async () => {
        const flour = await createIngredient("Bột mì", "kg");
        await q("INSERT INTO inventory (restaurant_id, ingredient_id, quantity, min_quantity) VALUES ($1, $2, 3, 2)", [f.r1, flour]);
        // Tiêu hao 14 kg trong 14 ngày -> 1 kg / ngày
        await q(
            `INSERT INTO inventory_transactions (restaurant_id, ingredient_id, type, quantity_change, quantity_after, unit_price)
            VALUES ($1, $2, 'consume', -14, 3, 0)`,
            [f.r1, flour],
        );
        const res = await api().get("/api/purchase-orders/suggestions").set(manager).query({ cover_days: 7 });
        expect(res.status).toBe(200);
        const row = res.body.data.items.find((i: any) => i.ingredient_id === flour);
        // 2 (ngưỡng) + 1 × 7 - 3 (tồn) = 6
        expect(row.avg_daily_usage).toBe(1);
        expect(row.suggested_quantity).toBe(6);
    });
});

describe("Lô hàng FEFO và hủy hàng", () => {
    it("xuất, phục vụ món và hủy hàng trừ lô hết hạn sớm nhất trước; hủy đúng một lô", async () => {
        // Chi nhánh 1 đang có lô L01 (+5 ngày, 6 l) và lô +6 ngày (4 l); thêm lô hết hạn sớm hơn
        expect(
            (
                await receipt(admin, {
                    type: "import",
                    restaurant_id: f.r1,
                    lines: [{ ingredient_id: milk, quantity: 2, unit_price: 30000, expiry_date: plusDays(1), lot_code: "OLD" }],
                })
            ).status,
        ).toBe(201);
        const exp = await receipt(admin, { type: "export", restaurant_id: f.r1, reason: "Dùng thử", lines: [{ ingredient_id: milk, quantity: 3 }] });
        expect(exp.status).toBe(201);
        const after = await lots(f.r1, milk);
        expect(after[0]).toMatchObject({ lot_code: "OLD", quantity: 0 });
        expect(after[1]).toMatchObject({ lot_code: "L01", quantity: 5 });

        // Phục vụ món có định lượng sữa: trừ tiếp lô L01
        const latte = await createDish("Latte", 45000, "drink");
        await q("INSERT INTO dish_ingredients (dish_id, ingredient_id, quantity) VALUES ($1, $2, 0.5)", [latte, milk]);
        const table = await createTable(f.rooms.hall, "LT1");
        const order = (await api().post("/api/orders").set(admin).send({ restaurant_id: f.r1, table_ids: [table], guest_count: 1 })).body.data.id;
        await api().post(`/api/orders/${order}/rounds`).set(admin).send({ items: [{ dish_id: latte, quantity: 2 }] });
        const [line] = (await api().get(`/api/orders/${order}`).set(admin)).body.data.rounds[0].lines;
        for (const s of ["cooking", "ready", "served"]) await api().patch(`/api/orders/dishes/${line.id}/status`).set(admin).send({ status: s });
        expect((await lots(f.r1, milk))[1]).toMatchObject({ lot_code: "L01", quantity: 4 });

        // Hủy đúng lô hết hạn sau cùng
        const lotsApi = (await api().get("/api/inventory/lots").set(manager).query({ ingredient_id: milk })).body.data;
        const latest = lotsApi.lots[lotsApi.lots.length - 1];
        expect(latest.quantity).toBe("4.000");
        const dispose = await receipt(manager, {
            type: "dispose",
            reason: "Hỏng do mất điện",
            lines: [{ ingredient_id: milk, quantity: 1, lot_id: latest.id }],
        });
        expect(dispose.status).toBe(201);
        expect(dispose.body.data.code).toMatch(/^HH-/);
        expect((await lots(f.r1, milk)).map((l: any) => l.quantity)).toEqual([0, 4, 3]);
        expect((await auditRows("inventory.dispose")).length).toBe(1);
        // Phục vụ / bếp chính hủy hàng được, phục vụ thì không
        expect((await receipt(bearer(f.users.waiter.token), { type: "dispose", reason: "x", lines: [{ ingredient_id: milk, quantity: 1 }] })).status).toBe(403);
    });

    it("cảnh báo sắp hết hạn", async () => {
        const res = await api().get("/api/inventory/lots").set(manager).query({ expiring_days: 5 });
        expect(res.status).toBe(200);
        expect(res.body.data.lots.every((l: any) => l.days_left <= 5)).toBe(true);
        expect(res.body.data.summary.warning_days).toBe(3);
    });
});

describe("Chuyển kho", () => {
    it("xuất: trừ kho bên gửi, lấy lô FEFO; nhận thiếu: cộng kho bên nhận, tạo lại lô, ghi hao hụt", async () => {
        const before = await stock(milk, f.r1);
        const res = await api()
            .post("/api/stock-transfers")
            .set(manager)
            .send({ to_restaurant_id: f.r2, lines: [{ ingredient_id: milk, quantity: 5 }, { ingredient_id: sugar, quantity: 2 }] });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        const transfer = res.body.data;
        expect(transfer.status).toBe("in_transit");
        expect(transfer.from_restaurant_id).toBe(f.r1);
        expect((await stock(milk, f.r1)).qty).toBeCloseTo(before.qty - 5, 3);
        const milkLine = transfer.lines.find((l: any) => l.ingredient_id === milk);
        expect(milkLine.lots.map((l: any) => l.quantity)).toEqual([4, 1]);

        // Chi nhánh gửi không tự xác nhận nhận hàng
        expect((await api().post(`/api/stock-transfers/${transfer.id}/receive`).set(manager).send({})).status).toBe(403);
        const received = await api()
            .post(`/api/stock-transfers/${transfer.id}/receive`)
            .set(manager2)
            .send({ lines: [{ line_id: milkLine.id, received_quantity: 4.5 }] });
        expect(received.status).toBe(200);
        expect(received.body.data.status).toBe("received");
        const dest = await stock(milk, f.r2);
        expect(dest.qty).toBe(4.5);
        expect(dest.avg).toBe(Number(milkLine.unit_cost));
        expect((await lots(f.r2, milk)).map((l: any) => l.quantity)).toEqual([4, 0.5]);
        expect(Number(received.body.data.loss_value)).toBeCloseTo(0.5 * Number(milkLine.unit_cost), 2);
        expect((await stock(sugar, f.r2)).qty).toBe(2);
        expect((await api().post(`/api/stock-transfers/${transfer.id}/cancel`).set(manager).send({})).status).toBe(400);
    });

    it("danh sách chi nhánh nhận: mọi chi nhánh trừ chi nhánh gửi", async () => {
        const res = await api().get("/api/stock-transfers/destinations").set(manager);
        expect(res.status).toBe(200);
        expect(res.body.data.map((r: any) => r.id)).toEqual([f.r2]);
        expect((await api().get("/api/stock-transfers/destinations").set(bearer(f.users.waiter.token))).status).toBe(403);
    });

    it("hủy phiếu đang chuyển: hoàn hàng và lô về bên gửi; chuyển cho chính mình, vượt tồn bị từ chối", async () => {
        const before = await stock(sugar, f.r1);
        const t = (await api().post("/api/stock-transfers").set(manager).send({ to_restaurant_id: f.r2, lines: [{ ingredient_id: sugar, quantity: 1 }] })).body.data;
        expect((await stock(sugar, f.r1)).qty).toBeCloseTo(before.qty - 1, 3);
        expect((await api().post(`/api/stock-transfers/${t.id}/cancel`).set(manager2).send({})).status).toBe(403);
        const cancelled = await api().post(`/api/stock-transfers/${t.id}/cancel`).set(manager).send({});
        expect(cancelled.body.data.status).toBe("cancelled");
        expect((await stock(sugar, f.r1)).qty).toBeCloseTo(before.qty, 3);

        expect((await api().post("/api/stock-transfers").set(manager).send({ to_restaurant_id: f.r1, lines: [{ ingredient_id: sugar, quantity: 1 }] })).status).toBe(400);
        expect((await api().post("/api/stock-transfers").set(manager).send({ to_restaurant_id: f.r2, lines: [{ ingredient_id: sugar, quantity: 999 }] })).status).toBe(400);
        // Manager chỉ gửi từ chi nhánh mình dù khai chi nhánh khác
        const spoof = await api()
            .post("/api/stock-transfers")
            .set(manager)
            .send({ from_restaurant_id: f.r2, to_restaurant_id: f.r2, lines: [{ ingredient_id: sugar, quantity: 1 }] });
        expect(spoof.status).toBe(201);
        expect(spoof.body.data.from_restaurant_id).toBe(f.r1);
        // Danh sách: mỗi bên thấy phiếu của mình
        const list = await api().get("/api/stock-transfers").set(manager2);
        expect(list.body.data.transfers.every((x: any) => x.to_restaurant_id === f.r2 || x.from_restaurant_id === f.r2)).toBe(true);
    });
});
