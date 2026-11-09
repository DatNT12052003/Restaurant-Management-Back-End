import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testOutbox } from "~/services/mail.service";
import { api, auditRows, baseFixture, bearer, createDish, createUser, Fixture, ITestUser, q } from "./helpers";

/** Giai đoạn 13: thực đơn công khai, đặt bàn online (OTP), gọi món QR, điểm thưởng, phản hồi, tài khoản khách */
let f: Fixture;
let admin: { Authorization: string };
let manager: { Authorization: string };
let waiter: { Authorization: string };
let cashier: { Authorization: string };
let guest: ITestUser;
let pho: number;
let tea: number;
let hidden: number;

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
const plusDays = (days: number) => new Date(Date.parse(`${today()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const tokenOf = async (tableId: number) => (await q("SELECT qr_token FROM tables WHERE id = $1", [tableId]))[0].qr_token as string;
const lastCode = () => {
    const mail = [...testOutbox].reverse().find((m) => /Mã xác nhận đặt bàn/.test(m.subject));
    return mail?.subject.match(/(\d{6})/)?.[1] ?? "";
};
const serveAll = async (orderId: number) => {
    const detail = (await api().get(`/api/orders/${orderId}`).set(admin)).body.data;
    for (const line of detail.rounds.flatMap((r: { lines: { id: number; kind?: string }[] }) => r.lines)) {
        for (const s of ["cooking", "ready", "served"]) await api().patch(`/api/orders/dishes/${line.id}/status`).set(admin).send({ status: s });
    }
};

beforeAll(async () => {
    f = await baseFixture();
    admin = bearer(f.users.admin.token);
    manager = bearer(f.users.manager.token);
    waiter = bearer(f.users.waiter.token);
    cashier = bearer(f.users.cashier.token);
    pho = await createDish("Phở bò", 60000);
    tea = await createDish("Trà đá", 5000, "drink");
    hidden = await createDish("Món tắt ở chi nhánh", 1000);
    await q("INSERT INTO restaurant_dishes (restaurant_id, dish_id, is_available) VALUES ($1, $2, false)", [f.r1, hidden]);
    await q("UPDATE restaurants SET phone = '0281111111' WHERE id = $1", [f.r1]);
    guest = await createUser("guest", null, { fullName: "Khách Quen" });
    await q("UPDATE users SET phone_number = '0901234567', email = 'khach@example.com' WHERE id = $1", [guest.userId]);
});

beforeEach(() => {
    testOutbox.length = 0;
});

describe("Thực đơn công khai và giờ trống", () => {
    it("danh sách chi nhánh và thực đơn chỉ có món đang bán, không cần đăng nhập", async () => {
        const list = await api().get("/api/public/restaurants");
        expect(list.status).toBe(200);
        expect(list.body.data.map((r: { id: number }) => r.id)).toEqual([f.r1, f.r2]);
        const menu = await api().get(`/api/public/restaurants/${f.r1}/menu`);
        expect(menu.status).toBe(200);
        const names = menu.body.data.dishes.map((d: { name: string }) => d.name);
        expect(names).toContain("Phở bò");
        expect(names).not.toContain("Món tắt ở chi nhánh");
        expect(menu.body.data.restaurant).toMatchObject({ phone: "0281111111", open_time: "08:00" });
        expect((await api().get("/api/public/restaurants/9999/menu")).status).toBe(404);
    });

    it("giờ trống theo khung 30 phút trong giờ mở cửa; quá số khách bị từ chối", async () => {
        const res = await api().get(`/api/public/restaurants/${f.r1}/slots?date=${plusDays(2)}&guest_count=2`);
        expect(res.status).toBe(200);
        expect(res.body.data[0]).toEqual({ time: "08:00", available: true });
        // Đóng cửa 22:00, mỗi lượt 120 phút: khung cuối 20:00
        expect(res.body.data.at(-1).time).toBe("20:00");
        expect((await api().get(`/api/public/restaurants/${f.r1}/slots?date=${plusDays(2)}&guest_count=21`)).status).toBe(400);
    });
});

describe("Đặt bàn online", () => {
    let code: string;
    let reservationId: number;
    const booking = (extra: Record<string, unknown> = {}) => ({
        restaurant_id: f.r1,
        date: plusDays(2),
        time: "19:00",
        guest_count: 4,
        contact_name: "Nguyễn Văn Khách",
        contact_phone: "0912 345 678",
        contact_email: "vanglai@example.com",
        ...extra,
    });

    it("khách vãng lai: gửi OTP, nhập sai bị đếm, đúng thì tạo đơn chờ xác nhận có bàn gợi ý và email", async () => {
        const otp = await api().post("/api/public/booking/otp").send({ email: "VangLai@example.com" });
        expect(otp.status).toBe(201);
        const otpCode = lastCode();
        expect(otpCode).toMatch(/^\d{6}$/);

        expect((await api().post("/api/public/reservations").send(booking())).status).toBe(400);
        const wrong = otpCode === "000000" ? "111111" : "000000";
        expect((await api().post("/api/public/reservations").send(booking({ otp_code: wrong }))).status).toBe(400);
        const [{ attempts }] = await q("SELECT attempts FROM booking_verifications ORDER BY id DESC LIMIT 1");
        expect(attempts).toBe(1);

        const res = await api().post("/api/public/reservations").send(booking({ otp_code: otpCode }));
        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ status: "pending", guest_count: 4, restaurant_name: "Nhà hàng Một" });
        expect(res.body.data).not.toHaveProperty("id");
        code = res.body.data.lookup_code;
        expect(code).toMatch(/^[A-Z2-9]{8}$/);
        const [row] = await q("SELECT id, source, contact_email, end_time - start_time AS span FROM reservations WHERE lookup_code = $1", [code]);
        reservationId = row.id;
        expect(row).toMatchObject({ source: "online", contact_email: "vanglai@example.com" });
        expect(await q("SELECT 1 FROM reservation_tables WHERE reservation_id = $1", [reservationId])).toHaveLength(1);
        await new Promise((r) => setTimeout(r, 50));
        expect(testOutbox.some((m) => m.to === "vanglai@example.com" && m.subject.includes("Đã nhận yêu cầu đặt bàn"))).toBe(true);

        // Mã đã dùng
        expect((await api().post("/api/public/reservations").send(booking({ otp_code: otpCode, time: "12:00" }))).status).toBe(400);
    });

    it("tối đa 3 mã / 15 phút cho một email", async () => {
        for (let i = 0; i < 2; i++) expect((await api().post("/api/public/booking/otp").send({ email: "vanglai@example.com" })).status).toBe(201);
        expect((await api().post("/api/public/booking/otp").send({ email: "vanglai@example.com" })).status).toBe(429);
    });

    it("tra cứu cần đúng số điện thoại; lễ tân xác nhận thì khách nhận email", async () => {
        expect((await api().get(`/api/public/reservations/${code}?phone=0999999999`)).status).toBe(404);
        const found = await api().get(`/api/public/reservations/${code.toLowerCase()}?phone=0912345678`);
        expect(found.status).toBe(200);
        const confirmed = await api().patch(`/api/reservations/${reservationId}/status`).set(bearer(f.users.receptionist.token)).send({ status: "confirmed" });
        expect(confirmed.status).toBe(200);
        await new Promise((r) => setTimeout(r, 100));
        expect(testOutbox.some((m) => m.subject.includes("Đặt bàn đã được xác nhận"))).toBe(true);
        const staffView = await api().get(`/api/reservations/${reservationId}`).set(manager);
        expect(staffView.body.data).toMatchObject({ source: "online", lookup_code: code });
    });

    it("giờ không hợp lệ, quá gần giờ đến, ngày nghỉ và hết bàn bị từ chối", async () => {
        await api().post("/api/public/booking/otp").send({ email: "a@example.com" });
        const otp = lastCode();
        const send = (extra: Record<string, unknown>) =>
            api().post("/api/public/reservations").send(booking({ contact_email: "a@example.com", otp_code: otp, ...extra }));
        expect((await send({ time: "03:00" })).status).toBe(400);
        expect((await send({ time: "21:00" })).status).toBe(400); // 21:00 + 2 giờ > 22:00
        expect((await send({ date: plusDays(60) })).status).toBe(400);
        await q("INSERT INTO restaurant_closed_days (restaurant_id, day) VALUES ($1, $2)", [f.r1, plusDays(3)]);
        expect((await send({ date: plusDays(3) })).status).toBe(400);
        await q("UPDATE restaurants SET online_booking_max_guests = 100 WHERE id = $1", [f.r1]);
        expect((await send({ guest_count: 90 })).status).toBe(409);
        await q("UPDATE restaurants SET online_booking_enabled = false WHERE id = $1", [f.r2]);
        expect((await send({ restaurant_id: f.r2 })).status).toBe(400);
    });

    it("khách đã đăng nhập đặt không cần OTP, xem và hủy trong tài khoản", async () => {
        const res = await api().post("/api/public/reservations").set(bearer(guest.token)).send({ restaurant_id: f.r1, date: plusDays(4), time: "11:30", guest_count: 2 });
        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ contact_name: "Khách Quen", contact_phone: "0901234567" });
        const mine = await api().get("/api/customer/reservations").set(bearer(guest.token));
        expect(mine.body.data).toHaveLength(1);
        const cancel = await api().post(`/api/customer/reservations/${mine.body.data[0].id}/cancel`).set(bearer(guest.token)).send({ reason: "Bận" });
        expect(cancel.status).toBe(200);
        expect(cancel.body.data).toMatchObject({ status: "cancelled", cancel_reason: "Khách hủy: Bận" });
        // Nhân viên không dùng được trang tài khoản khách
        expect((await api().get("/api/customer/me").set(waiter)).status).toBe(403);
    });

    it("khách vãng lai tự hủy bằng mã + SĐT", async () => {
        const res = await api().post(`/api/public/reservations/${code}/cancel`).send({ phone: "0912345678" });
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("cancelled");
        expect((await api().post(`/api/public/reservations/${code}/cancel`).send({ phone: "0912345678" })).status).toBe(400);
    });
});

describe("Gọi món QR tại bàn", () => {
    let token: string;
    let orderId: number;

    it("khách gửi món; tối đa 3 yêu cầu chờ mỗi bàn; món tắt bị từ chối", async () => {
        token = await tokenOf(f.tables.t1);
        const table = await api().get(`/api/public/tables/${token}`);
        expect(table.status).toBe(200);
        expect(table.body.data).toMatchObject({ table: { name: "B1", room_name: "Sảnh" }, order: null, feedback_order: null });

        const send = (body: Record<string, unknown>) => api().post(`/api/public/tables/${token}/requests`).send({ client_token: "browser-aaaa-1111", ...body });
        expect((await send({ dishes: [{ dish_id: hidden, quantity: 1 }] })).status).toBe(400);
        const first = await send({ guest_count: 3, dishes: [{ dish_id: pho, quantity: 2, note: "Ít hành" }], note: "Nhanh giúp" });
        expect(first.status).toBe(201);
        expect(first.body.data).toMatchObject({ status: "pending" });
        expect(first.body.data.lines[0]).toMatchObject({ name: "Phở bò", quantity: 2, note: "Ít hành" });
        expect(first.body.data).not.toHaveProperty("client_token");
        await send({ dishes: [{ dish_id: tea, quantity: 3 }] });
        await send({ dishes: [{ dish_id: tea, quantity: 1 }] });
        expect((await send({ dishes: [{ dish_id: tea, quantity: 1 }] })).status).toBe(429);

        const mine = await api().get(`/api/public/tables/${token}/requests?client_token=browser-aaaa-1111`);
        expect(mine.body.data).toHaveLength(3);
        expect((await api().get(`/api/public/tables/${token}/requests?client_token=browser-bbbb-2222`)).body.data).toHaveLength(0);
    });

    it("phục vụ duyệt: mở order và gửi bếp; duyệt tiếp thêm đợt vào cùng order; từ chối có lý do", async () => {
        const list = await api().get("/api/order-requests?status=pending").set(waiter);
        expect(list.status).toBe(200);
        const [third, second, first] = list.body.data;
        expect((await api().get("/api/order-requests").set(bearer(f.users.chef.token))).status).toBe(403);
        expect((await api().post(`/api/order-requests/${first.id}/accept`).set(bearer(f.users.waiter2.token))).status).toBe(404);

        const accepted = await api().post(`/api/order-requests/${first.id}/accept`).set(waiter);
        expect(accepted.status).toBe(200);
        expect(accepted.body.data.status).toBe("accepted");
        orderId = accepted.body.data.order_id;
        const order = (await api().get(`/api/orders/${orderId}`).set(admin)).body.data;
        expect(order).toMatchObject({ guest_count: 3, status: "serving" });
        expect(order.rounds[0]).toMatchObject({ note: "QR: Nhanh giúp" });
        expect((await api().post(`/api/order-requests/${first.id}/accept`).set(waiter)).status).toBe(400);

        await api().post(`/api/order-requests/${second.id}/accept`).set(waiter).expect(200);
        expect((await api().get(`/api/orders/${orderId}`).set(admin)).body.data.rounds).toHaveLength(2);
        const rejected = await api().post(`/api/order-requests/${third.id}/reject`).set(waiter).send({ reason: "Hết đá" });
        expect(rejected.body.data).toMatchObject({ status: "rejected", reject_reason: "Hết đá" });

        const table = await api().get(`/api/public/tables/${token}`);
        expect(table.body.data.order.lines.map((l: { name: string }) => l.name)).toEqual(["Phở bò", "Trà đá"]);
    });

    it("chi nhánh tắt gọi món QR; đổi mã QR thì mã cũ hết dùng", async () => {
        const t2 = await tokenOf(f.tables.t2);
        await q("UPDATE restaurants SET qr_ordering_enabled = false WHERE id = $1", [f.r1]);
        expect((await api().post(`/api/public/tables/${t2}/requests`).send({ client_token: "browser-cccc-3333", dishes: [{ dish_id: tea, quantity: 1 }] })).status).toBe(400);
        await q("UPDATE restaurants SET qr_ordering_enabled = true WHERE id = $1", [f.r1]);
        const rotated = await api().post(`/api/order-requests/tables/${f.tables.t2}/rotate-qr`).set(manager);
        expect(rotated.status).toBe(200);
        expect(rotated.body.data.qr_token).not.toBe(t2);
        expect((await api().get(`/api/public/tables/${t2}`)).status).toBe(404);
        expect((await api().post(`/api/order-requests/tables/${f.tables.t2}/rotate-qr`).set(bearer(f.users.chef.token))).status).toBe(403);
    });

    it("khách đã đăng nhập gọi món thì order được gắn tài khoản", async () => {
        const t3 = await tokenOf(f.tables.t3);
        const res = await api().post(`/api/public/tables/${t3}/requests`).set(bearer(guest.token)).send({ client_token: "browser-dddd-4444", dishes: [{ dish_id: pho, quantity: 1 }] });
        const accepted = await api().post(`/api/order-requests/${res.body.data.id}/accept`).set(waiter);
        const [order] = await q("SELECT guest_user_id FROM orders WHERE id = $1", [accepted.body.data.order_id]);
        expect(order.guest_user_id).toBe(guest.userId);
    });

    it("phản hồi qua QR: chỉ order vừa hoàn tất ở bàn, mỗi order một lần", async () => {
        await serveAll(orderId);
        const total = Number((await q("SELECT total FROM orders WHERE id = $1", [orderId]))[0].total);
        await api().post(`/api/orders/${orderId}/payments`).set(cashier).send({ method: "cash", amount: total }).expect(201);
        const table = await api().get(`/api/public/tables/${token}`);
        expect(table.body.data.order).toBeNull();
        expect(table.body.data.feedback_order.id).toBe(orderId);
        const body = { order_id: orderId, food_rating: 2, service_rating: 4, ambience_rating: 5, comment: "Phở nguội", is_complaint: true };
        expect((await api().post(`/api/public/tables/${token}/feedback`).send({ ...body, order_id: orderId + 999 })).status).toBe(400);
        expect((await api().post(`/api/public/tables/${token}/feedback`).send(body)).status).toBe(201);
        expect((await api().post(`/api/public/tables/${token}/feedback`).send(body)).status).toBe(409);
        expect((await api().get(`/api/public/tables/${token}`)).body.data.feedback_order).toBeNull();
    });
});

describe("Điểm thưởng", () => {
    let orderId: number;

    it("quản lý điều chỉnh điểm và cấu hình; thu ngân tra cứu khách theo SĐT", async () => {
        expect((await api().post(`/api/loyalty/guests/${guest.userId}/adjust`).set(cashier).send({ points: 100, note: "Tặng" })).status).toBe(403);
        const adj = await api().post(`/api/loyalty/guests/${guest.userId}/adjust`).set(manager).send({ points: 100, note: "Tặng khai trương" });
        expect(adj.status).toBe(200);
        expect(adj.body.data.loyalty_points).toBe(100);
        expect((await api().post(`/api/loyalty/guests/${guest.userId}/adjust`).set(manager).send({ points: -500, note: "x" })).status).toBe(400);
        const found = await api().get("/api/loyalty/guests?q=0901234").set(cashier);
        expect(found.body.data).toEqual([expect.objectContaining({ id: guest.userId, available_points: 100 })]);
        const settings = await api().patch("/api/loyalty/settings").set(manager).send({ regular_visit_count: 2 });
        expect(settings.body.data, JSON.stringify(settings.body)).toMatchObject({ earn_amount: 10000, point_value: 1000, max_redeem_percent: 50, regular_visit_count: 2 });
        expect(await auditRows("loyalty.settings_update")).toHaveLength(1);
    });

    it("đổi điểm tối đa 50% hóa đơn, điểm đang giữ không dùng ở order khác; hoàn tất trừ điểm đổi và cộng điểm mới", async () => {
        // Order đã gắn khách (từ gọi món QR ở bàn B3): 60.000đ
        [{ id: orderId }] = await q("SELECT id FROM orders WHERE guest_user_id = $1 AND status <> 'completed'", [guest.userId]);
        const redeem = await api().post(`/api/loyalty/orders/${orderId}/redeem`).set(cashier).send({ points: 100 });
        expect(redeem.status).toBe(200);
        expect(redeem.body.data).toMatchObject({ points_redeemed: 30, points_discount: 30000, available_points: 70 });
        const [o] = await q("SELECT discount_amount, total FROM orders WHERE id = $1", [orderId]);
        expect(Number(o.discount_amount)).toBe(30000);
        expect(Number(o.total)).toBe(30000);

        // Order khác của khách không dùng được phần đang giữ
        const opened = await api().post("/api/orders").set(admin).send({ restaurant_id: f.r1, table_ids: [f.tables.t4], guest_count: 2, guest_user_id: guest.userId });
        expect(opened.status, JSON.stringify(opened.body)).toBe(201);
        const other = opened.body.data.id;
        await api().post(`/api/orders/${other}/rounds`).set(admin).send({ items: [{ dish_id: pho, quantity: 4 }] });
        expect((await api().post(`/api/loyalty/orders/${other}/redeem`).set(cashier).send({ points: 80 })).status).toBe(400);

        await serveAll(orderId);
        await api().post(`/api/orders/${orderId}/payments`).set(cashier).send({ method: "cash", amount: 30000, tip_amount: 20000 }).expect(201);
        const [after] = await q("SELECT status, points_awarded FROM orders WHERE id = $1", [orderId]);
        // 30.000đ thực trả (tip không tính) -> 3 điểm
        expect(after).toMatchObject({ status: "completed", points_awarded: 3 });
        const ledger = await q("SELECT type, points, balance_after FROM loyalty_transactions WHERE user_id = $1 ORDER BY id", [guest.userId]);
        expect(ledger).toEqual([
            { type: "adjust", points: 100, balance_after: 100 },
            { type: "redeem", points: -30, balance_after: 70 },
            { type: "earn", points: 3, balance_after: 73 },
        ]);
        // Đổi điểm sau khi đã có thanh toán: không được
        await api().post(`/api/orders/${other}/payments`).set(cashier).send({ method: "cash", amount: 10000 });
        expect((await api().post(`/api/loyalty/orders/${other}/redeem`).set(cashier).send({ points: 10 })).status).toBe(400);
    });

    it("hoàn tiền trừ lại điểm đã cộng; đủ số lần ghé thì thành khách thân thiết", async () => {
        const [p] = await q("SELECT id FROM payments WHERE order_id = $1 AND type = 'payment'", [orderId]);
        await api().post(`/api/payments/${p.id}/refund`).set(manager).send({ amount: 20000, reason: "Món lỗi" }).expect(201);
        const [u] = await q("SELECT loyalty_points, guest_status FROM users WHERE id = $1", [guest.userId]);
        expect(u.loyalty_points).toBe(71);
        expect(u.guest_status).not.toBe("regular");

        // Lần ghé thứ hai (order B4 ở trên) -> khách thân thiết
        const [other] = await q("SELECT id, total FROM orders WHERE guest_user_id = $1 AND status = 'serving'", [guest.userId]);
        await serveAll(other.id);
        await api().post(`/api/orders/${other.id}/payments`).set(cashier).send({ method: "card", amount: Number(other.total) - 10000 }).expect(201);
        const [u2] = await q("SELECT loyalty_points, guest_status FROM users WHERE id = $1", [guest.userId]);
        expect(u2.guest_status).toBe("regular");
        expect(u2.loyalty_points).toBe(71 + 24);
    });

    it("trang tài khoản: hồ sơ điểm, lịch sử order và điểm; đánh giá order của mình", async () => {
        const me = await api().get("/api/customer/me").set(bearer(guest.token));
        expect(me.body.data).toMatchObject({ loyalty_points: 95, guest_status: "regular", visits: 2, regular_progress: { visits: 2, required: 2 } });
        const orders = await api().get("/api/customer/orders").set(bearer(guest.token));
        expect(orders.body.data).toHaveLength(2);
        expect(orders.body.data[0].lines.length).toBeGreaterThan(0);
        const points = await api().get("/api/customer/points").set(bearer(guest.token));
        expect(points.body.data[0]).toMatchObject({ type: "earn", points: 24 });

        const fb = await api().post(`/api/customer/orders/${orderId}/feedback`).set(bearer(guest.token)).send({ food_rating: 5, service_rating: 5, ambience_rating: 4, comment: "Ngon" });
        expect(fb.status).toBe(201);
        const other = await createUser("guest", null);
        expect((await api().post(`/api/customer/orders/${orderId}/feedback`).set(bearer(other.token)).send({ food_rating: 1, service_rating: 1, ambience_rating: 1 })).status).toBe(400);
    });
});

describe("Quản lý phản hồi", () => {
    it("thống kê theo chi nhánh, lọc khiếu nại, trả lời có nhật ký; phục vụ không xem được", async () => {
        const res = await api().get("/api/feedbacks").set(manager);
        expect(res.status).toBe(200);
        expect(res.body.data.summary).toMatchObject({ count: 2, complaints: 1, open: 2, avg_food: 3.5 });
        expect(res.body.data.summary.by_restaurant[0]).toMatchObject({ restaurant_id: f.r1, count: 2 });
        const complaints = await api().get("/api/feedbacks?complaint_only=true").set(manager);
        expect(complaints.body.data.feedbacks).toHaveLength(1);
        const id = complaints.body.data.feedbacks[0].id;
        const reply = await api().patch(`/api/feedbacks/${id}`).set(manager).send({ reply: "Xin lỗi quý khách, lần sau sẽ tốt hơn" });
        expect(reply.body.data).toMatchObject({ status: "resolved", reply: "Xin lỗi quý khách, lần sau sẽ tốt hơn" });
        expect(await auditRows("feedback.reply")).toHaveLength(1);
        expect((await api().get("/api/feedbacks").set(waiter)).status).toBe(403);
        expect((await api().patch(`/api/feedbacks/${id}`).set(bearer(f.users.manager2.token)).send({ status: "new" })).status).toBe(404);
    });
});

describe("Khách tự đăng ký", () => {
    it("luôn là khách mới; thiếu dữ liệu và trùng tên đăng nhập báo lỗi rõ", async () => {
        const body = { user: { full_name: "Khách Mới", phone_number: "0933000111", email: "moi@example.com", guest_status: "regular" }, account: { username: "khachmoi", password: "Matkhau1" } };
        const res = await api().post("/api/auth/register").send(body);
        expect(res.status).toBe(201);
        const [u] = await q("SELECT guest_status FROM users WHERE id = $1", [res.body.data.user.id]);
        expect(u.guest_status).toBe("new");
        expect((await api().post("/api/auth/register").send({ ...body, user: { ...body.user, email: "khac@example.com", phone_number: "0933000222" } })).body.message).toMatch(/[Uu]sername|đăng nhập/);
        expect((await api().post("/api/auth/register").send({ user: { full_name: "" }, account: { username: "abc", password: "1" } })).status).toBe(400);
    });
});

describe("Thu ngân gắn khách vào order", () => {
    it("gắn / gỡ khách khi chưa thanh toán; nhân viên khác chi nhánh và order đã thu tiền bị chặn", async () => {
        const id = (await api().post("/api/orders").set(admin).send({ restaurant_id: f.r1, table_ids: [f.tables.v1], guest_count: 2 })).body.data.id;
        await api().post(`/api/orders/${id}/rounds`).set(admin).send({ items: [{ dish_id: pho, quantity: 1 }] });
        const res = await api().post(`/api/loyalty/orders/${id}/guest`).set(cashier).send({ guest_user_id: guest.userId });
        expect(res.status).toBe(200);
        expect((await q("SELECT guest_user_id FROM orders WHERE id = $1", [id]))[0].guest_user_id).toBe(guest.userId);
        expect((await api().post(`/api/loyalty/orders/${id}/guest`).set(cashier).send({ guest_user_id: f.users.waiter.userId })).status).toBe(404);
        expect((await api().post(`/api/loyalty/orders/${id}/guest`).set(bearer(f.users.manager2.token)).send({ guest_user_id: null })).status).toBe(404);
        await api().post(`/api/orders/${id}/payments`).set(cashier).send({ method: "cash", amount: 10000 }).expect(201);
        expect((await api().post(`/api/loyalty/orders/${id}/guest`).set(cashier).send({ guest_user_id: null })).status).toBe(400);
        expect(await auditRows("loyalty.attach_guest")).toHaveLength(1);
    });
});
