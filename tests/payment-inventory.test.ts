import { beforeAll, describe, expect, it } from "vitest";
import { api, auditRows, baseFixture, bearer, createDish, createIngredient, createTable, Fixture, q } from "./helpers";

let f: Fixture;
let dish: number;
let admin: { Authorization: string };
let cashier: { Authorization: string };

beforeAll(async () => {
    f = await baseFixture();
    admin = bearer(f.users.admin.token);
    cashier = bearer(f.users.cashier.token);
    dish = await createDish("Lẩu", 100000);
});

/** Mở order trên một bàn mới của nhà hàng 1, gọi `qty` phần lẩu và phục vụ hết */
const servedOrder = async (qty = 2) => {
    const table = await createTable(f.rooms.hall, `TT-${Math.random().toString(36).slice(2, 7)}`);
    const id = (await api().post("/api/orders").set(admin).send({ restaurant_id: f.r1, table_ids: [table], guest_count: 2 })).body.data.id;
    await api().post(`/api/orders/${id}/rounds`).set(admin).send({ items: [{ dish_id: dish, quantity: qty }] });
    const detail = (await api().get(`/api/orders/${id}`).set(admin)).body.data;
    for (const line of detail.rounds.flatMap((r: any) => r.lines)) {
        for (const s of ["cooking", "ready", "served"]) await api().patch(`/api/orders/dishes/${line.id}/status`).set(admin).send({ status: s });
    }
    return id as number;
};
const order = async (id: number) => (await api().get(`/api/orders/${id}`).set(admin)).body.data;
const pay = (id: number, body: Record<string, unknown>) => api().post(`/api/orders/${id}/payments`).set(cashier).send(body);

describe("Phí, thuế và mã giảm giá", () => {
    it("phí và thuế chụp lúc mở order: tổng = net + phí + thuế (net + phí)", async () => {
        await q("UPDATE restaurants SET service_fee_percent = 5, tax_percent = 10 WHERE id = $1", [f.r1]);
        const id = await servedOrder(2);
        await q("UPDATE restaurants SET service_fee_percent = 0, tax_percent = 0 WHERE id = $1", [f.r1]);
        const o = await order(id);
        // 200.000 + 10.000 phí + 21.000 thuế
        expect(Number(o.service_fee)).toBe(10000);
        expect(Number(o.tax)).toBe(21000);
        expect(Number(o.total)).toBe(231000);
    });

    it("áp mã %, trần giảm tối đa; mã chưa tới giá trị tối thiểu bị từ chối; thay mã thì trả lượt mã cũ", async () => {
        const create = (body: Record<string, unknown>) => api().post("/api/discounts").set(admin).send({ name: "KM", ...body });
        expect((await create({ code: "giam10", type: "percent", value: 10, max_discount: 15000 })).status).toBe(201);
        expect((await create({ code: "GIAM10", type: "fixed", value: 1 })).status).toBe(400); // trùng (không phân biệt hoa thường)
        expect((await create({ code: "QUA100", type: "percent", value: 120 })).status).toBe(400);
        await create({ code: "TOITHIEU", type: "fixed", value: 5000, min_order_value: 1000000 });
        await create({ code: "BOT5K", type: "fixed", value: 5000, usage_limit: 1 });

        const id = await servedOrder(2);
        expect((await api().post(`/api/orders/${id}/discount`).set(cashier).send({ code: "TOITHIEU" })).status).toBe(400);
        expect((await api().post(`/api/orders/${id}/discount`).set(cashier).send({ code: "giam10" })).status).toBe(200);
        expect(Number((await order(id)).discount_amount)).toBe(15000);
        expect((await api().post(`/api/orders/${id}/discount`).set(cashier).send({ code: "BOT5K" })).status).toBe(200);
        const [old] = await q("SELECT used_count FROM discounts WHERE code = 'GIAM10'");
        expect(old.used_count).toBe(0);

        // BOT5K đã hết lượt (usage_limit = 1)
        const other = await servedOrder(1);
        expect((await api().post(`/api/orders/${other}/discount`).set(cashier).send({ code: "BOT5K" })).status).toBe(400);
    });

    it("manager chỉ tạo mã cho chi nhánh mình và không sửa được mã cả chuỗi", async () => {
        const m = bearer(f.users.manager.token);
        const own = await api().post("/api/discounts").set(m).send({ code: "CN1", name: "CN1", type: "fixed", value: 1000 });
        expect(own.status).toBe(201);
        expect(own.body.data.restaurant_id).toBe(f.r1);
        const [chain] = await q("SELECT id FROM discounts WHERE code = 'GIAM10'");
        expect((await api().patch(`/api/discounts/${chain.id}`).set(m).send({ value: 50 })).status).toBe(403);
    });
});

describe("Thu tiền và hoàn tiền", () => {
    it("tiền mặt tính tiền thối; không thu quá số còn phải thu; thu đủ thì order tự hoàn tất", async () => {
        const id = await servedOrder(2); // 200.000
        const first = await pay(id, { method: "cash", amount: 150000, received_amount: 200000 });
        expect(first.status).toBe(201);
        expect(Number(first.body.data.change_amount ?? first.body.data.payment?.change_amount)).toBe(50000);
        expect((await pay(id, { method: "card", amount: 60000 })).status).toBe(400);
        expect((await pay(id, { method: "card", amount: 50000 })).status).toBe(201);
        expect((await order(id)).status).toBe("completed");
    });

    it("giao dịch chờ xác nhận chặn hoàn tất; xác nhận xong thì hoàn tất", async () => {
        const id = await servedOrder(1);
        const p = await pay(id, { method: "transfer", amount: 100000, confirm: false });
        expect(p.status).toBe(201);
        expect((await order(id)).status).not.toBe("completed");
        const [pending] = await q("SELECT id FROM payments WHERE order_id = $1", [id]);
        expect((await api().post(`/api/payments/${pending.id}/confirm`).set(cashier)).status).toBe(200);
        expect((await order(id)).status).toBe("completed");
    });

    it("hoàn tiền: cần quyền và lý do, không vượt số đã thu, ghi nhật ký", async () => {
        const id = await servedOrder(1);
        await pay(id, { method: "card", amount: 100000 });
        const [p] = await q("SELECT id FROM payments WHERE order_id = $1", [id]);
        const url = `/api/payments/${p.id}/refund`;
        expect((await api().post(url).set(cashier).send({ amount: 1000, reason: "x" })).status).toBe(403);
        const m = bearer(f.users.manager.token);
        expect((await api().post(url).set(m).send({ amount: 1000 })).status).toBe(400);
        expect((await api().post(url).set(m).send({ amount: 200000, reason: "Quá" })).status).toBe(400);
        expect((await api().post(url).set(m).send({ amount: 30000, reason: "Món lỗi" })).status).toBe(201);
        const [log] = (await auditRows("payment.refund")).filter((l) => l.restaurant_id === f.r1);
        expect(log).toBeTruthy();
    });

    it("không hủy được order đã thu tiền", async () => {
        const id = await servedOrder(1);
        await pay(id, { method: "cash", amount: 10000, received_amount: 10000 });
        expect((await api().post(`/api/orders/${id}/cancel`).set(admin).send({ cancel_reason: "x" })).status).toBe(400);
    });

    it("3 lần thu toàn bộ cùng lúc: đúng 1 lần thành công", async () => {
        const id = await servedOrder(1);
        const results = await Promise.all([0, 1, 2].map(() => pay(id, { method: "card", amount: 100000 })));
        expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    });
});

describe("Kho", () => {
    let ing: number;

    beforeAll(async () => {
        ing = await createIngredient("Thịt bò");
    });

    const receipt = (body: Record<string, unknown>, token = f.users.manager.token) =>
        api().post("/api/inventory/receipts").set(bearer(token)).send(body);
    const stock = async () =>
        (await q("SELECT quantity, avg_unit_cost FROM inventory WHERE restaurant_id = $1 AND ingredient_id = $2", [f.r1, ing]))[0];

    it("nhập kho tính giá vốn bình quân gia quyền", async () => {
        expect((await receipt({ type: "import", supplier: "NCC A", lines: [{ ingredient_id: ing, quantity: 10, unit_price: 200000 }] })).status).toBe(201);
        expect((await receipt({ type: "import", lines: [{ ingredient_id: ing, quantity: 10, unit_price: 240000 }] })).status).toBe(201);
        const s = await stock();
        expect(Number(s.quantity)).toBe(20);
        expect(Number(s.avg_unit_cost)).toBe(220000);
    });

    it("xuất kho cần lý do, không vượt tồn, ghi nhật ký", async () => {
        expect((await receipt({ type: "export", lines: [{ ingredient_id: ing, quantity: 1 }] })).status).toBe(400);
        expect((await receipt({ type: "export", reason: "Hỏng", lines: [{ ingredient_id: ing, quantity: 999 }] })).status).toBe(400);
        expect((await receipt({ type: "export", reason: "Hỏng", lines: [{ ingredient_id: ing, quantity: 2 }] })).status).toBe(201);
        expect(Number((await stock()).quantity)).toBe(18);
        expect((await auditRows("inventory.export")).length).toBe(1);
    });

    it("kiểm kê chỉ ghi dòng lệch; không lệch thì báo lỗi", async () => {
        expect((await receipt({ type: "adjust", reason: "Kiểm kê", lines: [{ ingredient_id: ing, quantity: 18 }] })).status).toBe(400);
        expect((await receipt({ type: "adjust", reason: "Kiểm kê", lines: [{ ingredient_id: ing, quantity: 17.5 }] })).status).toBe(201);
        expect(Number((await stock()).quantity)).toBe(17.5);
    });

    it("3 phiếu xuất cùng lúc không làm tồn âm; tồn kho bằng tổng sổ biến động", async () => {
        const results = await Promise.all(
            [0, 1, 2].map(() => receipt({ type: "export", reason: "Dùng", lines: [{ ingredient_id: ing, quantity: 7 }] })),
        );
        expect(results.filter((r) => r.status === 201)).toHaveLength(2);
        const s = await stock();
        expect(Number(s.quantity)).toBe(3.5);
        const [sum] = await q(
            "SELECT SUM(quantity_change)::numeric AS total FROM inventory_transactions WHERE restaurant_id = $1 AND ingredient_id = $2",
            [f.r1, ing],
        );
        expect(Number(sum.total)).toBe(3.5);
    });

    it("pha chế chỉ xem kho; quản lý chi nhánh khác không lập phiếu cho chi nhánh này", async () => {
        expect((await receipt({ type: "import", lines: [{ ingredient_id: ing, quantity: 1, unit_price: 1 }] }, f.users.barista.token)).status).toBe(403);
        expect((await receipt({ type: "import", restaurant_id: f.r1, lines: [{ ingredient_id: ing, quantity: 1, unit_price: 1 }] }, f.users.manager2.token)).status).toBe(403);
    });
});
