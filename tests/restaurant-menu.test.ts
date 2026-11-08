import { beforeAll, describe, expect, it } from "vitest";
import { api, auditRows, baseFixture, bearer, createDish, createRoom, createTable, Fixture, q, settle } from "./helpers";

let f: Fixture;
let admin: { Authorization: string };
let manager: { Authorization: string };

beforeAll(async () => {
    f = await baseFixture();
    admin = bearer(f.users.admin.token);
    manager = bearer(f.users.manager.token);
});

describe("Nhà hàng", () => {
    it("admin tạo, sửa (phí, thuế, giờ mở cửa), ghi nhật ký chỉ các trường đổi", async () => {
        const created = await api().post("/api/restaurants").set(admin).send({ name: "Chi nhánh mới", address: "1 Lê Lợi" });
        expect(created.status).toBe(201);
        const id = created.body.data.id;
        const updated = await api()
            .patch(`/api/restaurants/${id}`)
            .set(admin)
            .send({ service_fee_percent: 5, tax_percent: 8, open_time: "10:00", close_time: "02:00" });
        expect(updated.status).toBe(200);
        expect(updated.body.data.close_time).toMatch(/^02:00/);
        await settle();
        const [log] = (await auditRows("restaurant.update")).filter((l) => l.entity_id === id);
        expect(Object.keys(log.after).sort()).toEqual(["close_time", "open_time", "service_fee_percent", "tax_percent"]);
    });

    it("từ chối giờ sai định dạng và tỷ lệ ngoài 0–100", async () => {
        expect((await api().patch(`/api/restaurants/${f.r1}`).set(admin).send({ open_time: "25:00" })).status).toBe(400);
        expect((await api().patch(`/api/restaurants/${f.r1}`).set(admin).send({ tax_percent: 120 })).status).toBe(400);
    });

    it("manager không tạo được nhà hàng; chỉ thấy nhà hàng của mình", async () => {
        expect((await api().post("/api/restaurants").set(manager).send({ name: "X", address: "Y" })).status).toBe(403);
        const all = await api().get("/api/restaurants/all").set(manager);
        expect(all.body.data.map((r: any) => r.id)).toEqual([f.r1]);
    });

    it("không xóa được nhà hàng còn phòng hoặc nhân viên", async () => {
        expect((await api().delete(`/api/restaurants/${f.r2}`).set(admin)).status).toBe(400);
    });
});

describe("Phòng và bàn", () => {
    it("manager tạo phòng thì tự gán nhà hàng của mình", async () => {
        const res = await api().post("/api/rooms").set(manager).send({ name: "Sân vườn", type: "public" });
        expect(res.status).toBe(201);
        expect(res.body.data.restaurant_id).toBe(f.r1);
    });

    it("phòng riêng tối đa 5 bàn", async () => {
        const room = await createRoom(f.r1, "Riêng 5", "private");
        for (let i = 1; i <= 5; i++) {
            expect((await api().post("/api/tables").set(manager).send({ name: `P${i}`, room_id: room, capacity: 4 })).status).toBe(201);
        }
        expect((await api().post("/api/tables").set(manager).send({ name: "P6", room_id: room })).status).toBe(400);
    });

    it("tên bàn trùng trong cùng phòng bị từ chối", async () => {
        const res = await api().post("/api/tables").set(manager).send({ name: "B1", room_id: f.rooms.hall });
        expect(res.status).toBe(400);
    });

    it("manager không thêm bàn vào phòng của chi nhánh khác", async () => {
        const res = await api().post("/api/tables").set(manager).send({ name: "Z9", room_id: f.rooms.r2room });
        expect([403, 404]).toContain(res.status);
    });

    it("không xóa được bàn đang có khách", async () => {
        const t = await createTable(f.rooms.hall, "Xóa thử");
        await q("UPDATE tables SET status = 'occupied' WHERE id = $1", [t]);
        expect((await api().delete(`/api/tables/${t}`).set(manager)).status).toBe(400);
        await q("UPDATE tables SET status = 'available' WHERE id = $1", [t]);
        expect((await api().delete(`/api/tables/${t}`).set(manager)).status).toBe(200);
    });

    it("PATCH được phép qua CORS preflight từ origin của frontend", async () => {
        const res = await api()
            .options(`/api/tables/${f.tables.t1}`)
            .set("Origin", "http://localhost:5173")
            .set("Access-Control-Request-Method", "PATCH");
        expect(res.status).toBe(204);
        expect(res.headers["access-control-allow-methods"]).toContain("PATCH");
    });
});

describe("Thực đơn", () => {
    it("tạo món, tên trùng (không phân biệt hoa thường) bị từ chối", async () => {
        const a = await api().post("/api/dishes").set(admin).send({ name: "Phở bò", price: 60000, category: "food" });
        expect(a.status).toBe(201);
        expect((await api().post("/api/dishes").set(admin).send({ name: "PHỞ BÒ", price: 1000 })).status).toBe(400);
    });

    it("combo cần ít nhất một món; không xóa được món đang nằm trong combo", async () => {
        const d1 = await createDish("Cơm gà", 50000);
        const d2 = await createDish("Trà đá", 5000, "drink");
        expect((await api().post("/api/combos").set(admin).send({ name: "Combo rỗng", price: 1, items: [] })).status).toBe(400);
        const combo = await api()
            .post("/api/combos")
            .set(admin)
            .send({ name: "Combo trưa", price: 52000, items: [{ dish_id: d1, quantity: 1 }, { dish_id: d2, quantity: 1 }] });
        expect(combo.status).toBe(201);
        expect((await api().delete(`/api/dishes/${d1}`).set(admin)).status).toBe(400);
    });

    it("giá chi nhánh: đặt giá riêng, tắt món, đặt lại về mặc định thì xóa dòng ghi đè", async () => {
        const d = await createDish("Bún chả", 55000);
        const url = `/api/restaurant-menus/${f.r1}/dishes/${d}`;
        expect((await api().patch(url).set(manager).send({ price: 60000 })).status).toBe(200);
        let menu = await api().get(`/api/restaurant-menus/${f.r1}`).set(manager);
        const item = () => menu.body.data.dishes.find((x: any) => x.id === d);
        expect(Number(item().price)).toBe(60000);
        await api().patch(url).set(manager).send({ is_available: false });
        menu = await api().get(`/api/restaurant-menus/${f.r1}`).set(manager);
        expect(item().is_available).toBe(false);
        await api().patch(url).set(manager).send({ price: null, is_available: true });
        expect(await q("SELECT 1 FROM restaurant_dishes WHERE dish_id = $1", [d])).toHaveLength(0);
    });

    it("manager không sửa thực đơn chi nhánh khác", async () => {
        const d = await createDish("Nem rán", 40000);
        expect((await api().patch(`/api/restaurant-menus/${f.r2}/dishes/${d}`).set(manager).send({ price: 1 })).status).toBe(403);
    });

    it("phục vụ chỉ xem thực đơn, không sửa được", async () => {
        const w = bearer(f.users.waiter.token);
        expect((await api().get("/api/dishes").set(w)).status).toBe(200);
        expect((await api().post("/api/dishes").set(w).send({ name: "X", price: 1 })).status).toBe(403);
    });
});
