import { beforeAll, describe, expect, it } from "vitest";
import { api, auditRows, baseFixture, bearer, createUser, Fixture, ITestUser, q } from "./helpers";

/** Giai đoạn 12: nhân sự — ca làm, đổi ca, chấm công QR, tăng ca, nghỉ phép, lương, đánh giá, chi phí nhân công */
let f: Fixture;
let admin: { Authorization: string };
let manager: { Authorization: string };
let manager2: { Authorization: string };
let supervisor: { Authorization: string };
let waiter: { Authorization: string };
let waiterB: ITestUser;

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
const plusDays = (days: number, from = today()) => new Date(Date.parse(`${from}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** Tháng trước (theo giờ Việt Nam): "YYYY-MM" và ngày thứ n */
const prevMonth = () => {
    const [y, m] = today().split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 2, 1));
    return d.toISOString().slice(0, 7);
};
const prevDay = (n: number) => `${prevMonth()}-${String(n).padStart(2, "0")}`;
const vn = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`).toISOString();

beforeAll(async () => {
    f = await baseFixture();
    admin = bearer(f.users.admin.token);
    manager = bearer(f.users.manager.token);
    manager2 = bearer(f.users.manager2.token);
    supervisor = bearer(f.users.supervisor.token);
    waiter = bearer(f.users.waiter.token);
    waiterB = await createUser("waitstaff", f.r1, { fullName: "Phục vụ B" });
});

describe("Phân quyền và cấu hình", () => {
    it("nhân viên chỉ dùng được /me; quản lý xem được nhân viên chi nhánh, không xem chi nhánh khác", async () => {
        expect((await api().get("/api/hr/me/status").set(waiter)).status).toBe(200);
        expect((await api().get(`/api/hr/shifts?from=${today()}&to=${today()}`).set(waiter)).status).toBe(403);
        const staff = await api().get("/api/hr/staff").set(manager);
        expect(staff.status).toBe(200);
        expect(staff.body.data.map((s: { id: number }) => s.id)).toContain(f.users.waiter.userId);
        expect((await api().get(`/api/hr/staff?restaurant_id=${f.r2}`).set(manager)).status).toBe(403);
        // Admin phải chỉ định chi nhánh
        expect((await api().get("/api/hr/staff").set(admin)).status).toBe(400);
        // Giám sát không có quyền xem lương: danh sách không kèm mức lương
        const sup = await api().get("/api/hr/staff").set(supervisor);
        expect(sup.status).toBe(200);
        expect(sup.body.data[0]).not.toHaveProperty("pay_amount");
    });

    it("quản lý sửa cấu hình (có nhật ký); giám sát không sửa được", async () => {
        const res = await api().patch("/api/hr/settings").set(manager).send({ late_penalty_amount: 50000, late_grace_minutes: 5 });
        expect(res.status).toBe(200);
        expect(Number(res.body.data.late_penalty_amount)).toBe(50000);
        expect(res.body.data).not.toHaveProperty("qr_secret");
        expect((await api().patch("/api/hr/settings").set(supervisor).send({ late_grace_minutes: 10 })).status).toBe(403);
        expect(await auditRows("hr.settings_update")).toHaveLength(1);
    });
});

describe("Ca mẫu và lịch làm việc", () => {
    let morning: number;

    it("tạo ca mẫu; trùng tên bị từ chối", async () => {
        const res = await api().post("/api/hr/shift-templates").set(manager).send({ name: "Ca sáng", start_time: "08:00", end_time: "17:00", break_minutes: 60 });
        expect(res.status).toBe(201);
        morning = res.body.data.id;
        expect(res.body.data.start_time).toBe("08:00");
        expect((await api().post("/api/hr/shift-templates").set(manager).send({ name: "ca sáng", start_time: "06:00", end_time: "10:00" })).status).toBe(409);
        const night = await api().post("/api/hr/shift-templates").set(manager).send({ name: "Ca đêm", start_time: "22:00", end_time: "06:00" });
        expect(night.status).toBe(201);
    });

    it("xếp ca hàng loạt, ca qua đêm, chặn trùng giờ, chặn xếp cho người cấp cao hơn", async () => {
        const dates = [plusDays(20), plusDays(21)];
        const res = await api()
            .post("/api/hr/shifts")
            .set(manager)
            .send({ user_ids: [f.users.waiter.userId, waiterB.userId], dates, shift_template_id: morning });
        expect(res.status).toBe(201);
        expect(res.body.data).toHaveLength(4);
        expect(res.body.data[0]).toMatchObject({ break_minutes: 60, template_name: "Ca sáng" });

        // Ca qua đêm kết thúc ngày hôm sau
        const night = await api().post("/api/hr/shifts").set(manager).send({ user_ids: [waiterB.userId], dates: [plusDays(22)], start_time: "22:00", end_time: "06:00" });
        expect(night.status).toBe(201);
        const s = night.body.data[0];
        expect((Date.parse(s.end_at) - Date.parse(s.start_at)) / 3_600_000).toBe(8);

        // Trùng giờ với ca đã có
        const overlap = await api().post("/api/hr/shifts").set(manager).send({ user_ids: [f.users.waiter.userId], dates: [plusDays(20)], start_time: "16:00", end_time: "20:00" });
        expect(overlap.status).toBe(409);
        // Giám sát không xếp ca cho quản lý
        const up = await api().post("/api/hr/shifts").set(supervisor).send({ user_ids: [f.users.manager.userId], dates: [plusDays(23)], shift_template_id: morning });
        expect(up.status).toBe(403);
        // Nhân viên chi nhánh khác
        const other = await api().post("/api/hr/shifts").set(manager).send({ user_ids: [f.users.waiter2.userId], dates: [plusDays(23)], shift_template_id: morning });
        expect(other.status).toBe(404);

        const mine = await api().get(`/api/hr/me/shifts?from=${plusDays(19)}&to=${plusDays(25)}`).set(waiter);
        expect(mine.body.data).toHaveLength(2);
    });

    it("sao chép lịch sang tuần khác, bỏ qua ca trùng", async () => {
        const res = await api().post("/api/hr/shifts/copy-week").set(manager).send({ from_week: plusDays(20), to_week: plusDays(27) });
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ created: 5, skipped: 0 });
        const again = await api().post("/api/hr/shifts/copy-week").set(manager).send({ from_week: plusDays(20), to_week: plusDays(27) });
        expect(again.body.data).toEqual({ created: 0, skipped: 5 });
    });
});

describe("Đổi ca", () => {
    it("nhường ca: người nhận đồng ý, quản lý duyệt, ca chuyển người; người khác không trả lời thay được", async () => {
        const [shift] = (await api().get(`/api/hr/me/shifts?from=${plusDays(21)}&to=${plusDays(21)}`).set(waiter)).body.data;
        const res = await api().post("/api/hr/me/swaps").set(waiter).send({ assignment_id: shift.id, target_user_id: f.users.barista.userId, reason: "Bận việc nhà" });
        expect(res.status).toBe(201);
        const swapId = res.body.data.id;
        // Cùng ca không mở thêm yêu cầu khác
        expect((await api().post("/api/hr/me/swaps").set(waiter).send({ assignment_id: shift.id, target_user_id: waiterB.userId })).status).toBe(400);
        // Quản lý chưa duyệt được khi người nhận chưa đồng ý
        expect((await api().post(`/api/hr/shift-swaps/${swapId}/approve`).set(manager).send({})).status).toBe(400);
        expect((await api().post(`/api/hr/me/swaps/${swapId}/accept`).set(bearer(waiterB.token))).status).toBe(404);
        expect((await api().post(`/api/hr/me/swaps/${swapId}/accept`).set(bearer(f.users.barista.token))).status).toBe(200);
        const approved = await api().post(`/api/hr/shift-swaps/${swapId}/approve`).set(manager).send({ note: "OK" });
        expect(approved.status).toBe(200);
        expect(approved.body.data.status).toBe("approved");
        const [row] = await q("SELECT user_id FROM shift_assignments WHERE id = $1", [shift.id]);
        expect(row.user_id).toBe(f.users.barista.userId);
        expect(await auditRows("shift.swap_approve")).toHaveLength(1);
    });

    it("đổi ca hai chiều hoán đổi người của hai ca", async () => {
        const [mine] = (await api().get(`/api/hr/me/shifts?from=${plusDays(20)}&to=${plusDays(20)}`).set(waiter)).body.data;
        const theirs = await api().get(`/api/hr/me/colleague-shifts?user_id=${waiterB.userId}&from=${plusDays(22)}&to=${plusDays(23)}`).set(waiter);
        expect(theirs.status).toBe(200);
        const target = theirs.body.data[0];
        const res = await api().post("/api/hr/me/swaps").set(waiter).send({ assignment_id: mine.id, target_user_id: waiterB.userId, target_assignment_id: target.id });
        expect(res.status).toBe(201);
        await api().post(`/api/hr/me/swaps/${res.body.data.id}/accept`).set(bearer(waiterB.token)).expect(200);
        // Không trùng giờ: waiterB đã có ca sáng ngày +20 nên nhận thêm ca của waiter sẽ trùng
        const decided = await api().post(`/api/hr/shift-swaps/${res.body.data.id}/approve`).set(manager).send({});
        expect(decided.status).toBe(409);
        const rejected = await api().post(`/api/hr/shift-swaps/${res.body.data.id}/reject`).set(manager).send({ note: "Trùng ca" });
        expect(rejected.body.data.status).toBe("rejected");
    });
});

describe("Chấm công QR", () => {
    let attendanceId: number;

    it("thu ngân lấy mã QR; phục vụ vào ca muộn bị ghi muộn và phạt tự động; mã sai / chi nhánh khác bị từ chối", async () => {
        // Ca bắt đầu 20 phút trước
        await q(
            `INSERT INTO shift_assignments (restaurant_id, user_id, work_date, start_at, end_at, break_minutes)
            VALUES ($1, $2, $3, now() - interval '20 minutes', now() + interval '4 hours', 0)`,
            [f.r1, f.users.waiter.userId, today()],
        );
        expect((await api().get("/api/hr/attendance/qr").set(waiter)).status).toBe(403);
        const qr = await api().get("/api/hr/attendance/qr").set(bearer(f.users.cashier.token));
        expect(qr.status).toBe(200);
        const qr2 = await api().get(`/api/hr/attendance/qr?restaurant_id=${f.r2}`).set(admin);

        expect((await api().post("/api/hr/me/clock").set(waiter).send({ token: `${f.r1}.1.abc` })).status).toBe(400);
        expect((await api().post("/api/hr/me/clock").set(waiter).send({ token: qr2.body.data.token })).status).toBe(400);

        const inRes = await api().post("/api/hr/me/clock").set(waiter).send({ token: qr.body.data.token });
        expect(inRes.status).toBe(200);
        expect(inRes.body.data.action).toBe("clock_in");
        expect(inRes.body.data.attendance.late_minutes).toBeGreaterThanOrEqual(19);
        attendanceId = inRes.body.data.attendance.id;
        const [penalty] = await q("SELECT amount, source FROM employee_adjustments WHERE attendance_id = $1 AND deleted_at IS NULL", [attendanceId]);
        expect(penalty).toMatchObject({ source: "late" });
        expect(Number(penalty.amount)).toBe(50000);

        const status = await api().get("/api/hr/me/status").set(waiter);
        expect(status.body.data.open_attendance.id).toBe(attendanceId);

        const outRes = await api().post("/api/hr/me/clock").set(waiter).send({ token: qr.body.data.token });
        expect(outRes.body.data.action).toBe("clock_out");
        expect(outRes.body.data.attendance.early_leave_minutes).toBeGreaterThan(200);
    });

    it("quản lý sửa giờ vào đúng giờ ca: hết muộn, phạt tự động bị gỡ; có nhật ký", async () => {
        const [shift] = await q("SELECT start_at FROM shift_assignments sa JOIN attendance_records a ON a.assignment_id = sa.id WHERE a.id = $1", [attendanceId]);
        const res = await api().patch(`/api/hr/attendance/${attendanceId}`).set(manager).send({ clock_in_at: new Date(shift.start_at).toISOString() });
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ late_minutes: 0, method: "manual" });
        expect(await q("SELECT id FROM employee_adjustments WHERE attendance_id = $1 AND deleted_at IS NULL", [attendanceId])).toHaveLength(0);
        expect(await auditRows("attendance.update")).toHaveLength(1);
        // Quản lý không tự sửa chấm công cho mình
        const own = await api().post("/api/hr/attendance").set(manager).send({ user_id: f.users.manager.userId, clock_in_at: vn(plusDays(-3), "08:00"), clock_out_at: vn(plusDays(-3), "12:00") });
        expect(own.status).toBe(403);
    });

    it("ghi tay lượt có giờ ngoài ca thành tăng ca chờ duyệt; duyệt có nhật ký; lượt trùng bị từ chối", async () => {
        const day = plusDays(-2);
        const shifts = await api().post("/api/hr/shifts").set(manager).send({ user_ids: [waiterB.userId], dates: [day], start_time: "08:00", end_time: "12:00" });
        const res = await api()
            .post("/api/hr/attendance")
            .set(manager)
            .send({ user_id: waiterB.userId, assignment_id: shifts.body.data[0].id, clock_in_at: vn(day, "07:30"), clock_out_at: vn(day, "13:00") });
        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ late_minutes: 0, worked_minutes: 330, overtime_minutes: 90, overtime_status: "pending" });
        const dup = await api().post("/api/hr/attendance").set(manager).send({ user_id: waiterB.userId, clock_in_at: vn(day, "12:00"), clock_out_at: vn(day, "14:00") });
        expect(dup.status).toBe(400);
        const ot = await api().post(`/api/hr/attendance/${res.body.data.id}/overtime`).set(supervisor).send({ approve: true });
        expect(ot.status).toBe(200);
        expect(ot.body.data.overtime_status).toBe("approved");
        expect(await auditRows("attendance.overtime_approve")).toHaveLength(1);
        const list = await api().get(`/api/hr/attendance?from=${day}&to=${day}`).set(manager);
        expect(list.body.data).toHaveLength(1);
    });
});

describe("Nghỉ phép", () => {
    it("xin nghỉ, trùng ngày bị từ chối, duyệt gỡ các ca chưa chấm công trong những ngày nghỉ", async () => {
        const res = await api().post("/api/hr/me/leaves").set(bearer(waiterB.token)).send({ start_date: plusDays(27), end_date: plusDays(28), type: "paid", reason: "Về quê" });
        expect(res.status).toBe(201);
        expect(res.body.data.days).toBe(2);
        expect((await api().post("/api/hr/me/leaves").set(bearer(waiterB.token)).send({ start_date: plusDays(28), end_date: plusDays(29), type: "unpaid" })).status).toBe(409);
        // Nhân viên không tự duyệt
        expect((await api().post(`/api/hr/leaves/${res.body.data.id}/approve`).set(waiter).send({})).status).toBe(403);
        const before = await q("SELECT id FROM shift_assignments WHERE user_id = $1 AND work_date BETWEEN $2 AND $3 AND deleted_at IS NULL", [waiterB.userId, plusDays(27), plusDays(28)]);
        expect(before.length).toBeGreaterThan(0);
        const approved = await api().post(`/api/hr/leaves/${res.body.data.id}/approve`).set(manager).send({});
        expect(approved.status).toBe(200);
        const after = await q("SELECT id FROM shift_assignments WHERE user_id = $1 AND work_date BETWEEN $2 AND $3 AND deleted_at IS NULL", [waiterB.userId, plusDays(27), plusDays(28)]);
        expect(after).toHaveLength(0);
        const [log] = await auditRows("leave.approve");
        expect(log.after.removed_shifts).toHaveLength(before.length);
    });
});

describe("Lương và bảng lương", () => {
    let payrollId: number;

    it("lịch sử lương: thêm mức, trùng ngày bị từ chối, đổi lương ở hồ sơ tạo mức mới; người không có quyền không xem được", async () => {
        const res = await api()
            .post(`/api/hr/employees/${f.users.waiter.userId}/compensations`)
            .set(manager)
            .send({ pay_type: "monthly", amount: 5_200_000, effective_from: prevDay(1) });
        expect(res.status).toBe(201);
        expect((await api().post(`/api/hr/employees/${f.users.waiter.userId}/compensations`).set(manager).send({ pay_type: "monthly", amount: 1, effective_from: prevDay(1) })).status).toBe(409);
        await api().post(`/api/hr/employees/${f.users.cashier.userId}/compensations`).set(manager).send({ pay_type: "hourly", amount: 30_000, effective_from: prevDay(1) }).expect(201);
        expect((await api().get(`/api/hr/employees/${f.users.waiter.userId}/compensations`).set(supervisor)).status).toBe(403);
        expect((await api().get(`/api/hr/employees/${f.users.waiter.userId}/compensations`).set(manager2)).status).toBe(404);

        const [user] = await q("SELECT salary FROM users WHERE id = $1", [f.users.waiter.userId]);
        expect(Number(user.salary)).toBe(5_200_000);

        const profile = await api().patch(`/api/users/employee/${waiterB.userId}`).set(manager).field("user[salary]", "6000000");
        expect(profile.status).toBe(200);
        const history = await api().get(`/api/hr/employees/${waiterB.userId}/compensations`).set(manager);
        expect(history.body.data).toHaveLength(1);
        expect(history.body.data[0]).toMatchObject({ pay_type: "monthly", effective_from: today() });
    });

    it("tính bảng lương tháng trước: ngày công, nghỉ có lương, tăng ca đã duyệt, phụ cấp, thưởng, lương giờ", async () => {
        // Phục vụ: 3 ngày ca 08:00–17:00 (nghỉ 60 phút); ngày thứ 3 ra muộn 1 giờ (tăng ca, duyệt)
        const shifts = await api()
            .post("/api/hr/shifts")
            .set(manager)
            .send({ user_ids: [f.users.waiter.userId], dates: [prevDay(10), prevDay(11), prevDay(12)], start_time: "08:00", end_time: "17:00", break_minutes: 60 });
        expect(shifts.status).toBe(201);
        for (const s of shifts.body.data) {
            const out = s.work_date === prevDay(12) ? "18:00" : "17:00";
            const res = await api()
                .post("/api/hr/attendance")
                .set(manager)
                .send({ user_id: f.users.waiter.userId, assignment_id: s.id, clock_in_at: vn(s.work_date, "08:00"), clock_out_at: vn(s.work_date, out) });
            expect(res.status).toBe(201);
            if (res.body.data.overtime_minutes > 0) {
                await api().post(`/api/hr/attendance/${res.body.data.id}/overtime`).set(manager).send({ approve: true }).expect(200);
            }
        }
        // Nghỉ có lương 2 ngày
        const leave = await api().post("/api/hr/me/leaves").set(waiter).send({ start_date: prevDay(20), end_date: prevDay(21), type: "paid" });
        await api().post(`/api/hr/leaves/${leave.body.data.id}/approve`).set(manager).send({}).expect(200);
        await api().post(`/api/hr/employees/${f.users.waiter.userId}/allowances`).set(manager).send({ name: "Ăn trưa", amount: 500_000 }).expect(201);
        await api()
            .post("/api/hr/adjustments")
            .set(manager)
            .send({ user_id: f.users.waiter.userId, type: "bonus", amount: 100_000, reason: "Phục vụ tốt", effective_date: prevDay(15) })
            .expect(201);

        // Thu ngân lương giờ: ca 08:00–12:00
        const cs = await api().post("/api/hr/shifts").set(manager).send({ user_ids: [f.users.cashier.userId], dates: [prevDay(10)], start_time: "08:00", end_time: "12:00" });
        await api()
            .post("/api/hr/attendance")
            .set(manager)
            .send({ user_id: f.users.cashier.userId, assignment_id: cs.body.data[0].id, clock_in_at: vn(prevDay(10), "08:00"), clock_out_at: vn(prevDay(10), "12:00") })
            .expect(201);

        const res = await api().post("/api/hr/payrolls/calculate").set(manager).send({ month: prevMonth() });
        expect(res.status).toBe(200);
        payrollId = res.body.data.id;
        const item = res.body.data.items.find((i: { user_id: number }) => i.user_id === f.users.waiter.userId);
        // 5.200.000 / 26 = 200.000 / ngày; 3 ngày công + 2 ngày nghỉ có lương
        expect(item).toMatchObject({ work_days: 3, paid_leave_days: 2, overtime_minutes: 60 });
        expect(Number(item.base_pay)).toBe(1_000_000);
        // 1 giờ × (200.000 / 8) × 1,5
        expect(Number(item.overtime_pay)).toBe(37_500);
        expect(Number(item.allowance_total)).toBe(500_000);
        expect(Number(item.bonus_total)).toBe(100_000);
        expect(Number(item.net_pay)).toBe(1_637_500);
        const cashier = res.body.data.items.find((i: { user_id: number }) => i.user_id === f.users.cashier.userId);
        expect(Number(cashier.base_pay)).toBe(120_000);
        // Chi nhánh khác không xem được
        expect((await api().get(`/api/hr/payrolls/${payrollId}`).set(manager2)).status).toBe(404);
    });

    it("chốt bảng lương: khóa thưởng / phạt, chấm công, tính lại; DB chặn sửa; nhân viên xem phiếu lương", async () => {
        const res = await api().post(`/api/hr/payrolls/${payrollId}/finalize`).set(manager);
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("finalized");
        expect(await auditRows("payroll.finalize")).toHaveLength(1);

        expect((await api().post("/api/hr/payrolls/calculate").set(manager).send({ month: prevMonth() })).status).toBe(400);
        expect(
            (await api().post("/api/hr/adjustments").set(manager).send({ user_id: f.users.waiter.userId, type: "penalty", amount: 1, reason: "x", effective_date: prevDay(3) })).status,
        ).toBe(400);
        const [att] = await q("SELECT id FROM attendance_records WHERE user_id = $1 AND work_date = $2", [f.users.waiter.userId, prevDay(10)]);
        expect((await api().delete(`/api/hr/attendance/${att.id}`).set(manager)).status).toBe(400);
        const [bonus] = await q("SELECT id, payroll_id FROM employee_adjustments WHERE type = 'bonus' AND user_id = $1", [f.users.waiter.userId]);
        expect(bonus.payroll_id).toBe(payrollId);
        await expect(q("UPDATE payroll_items SET net_pay = 0 WHERE payroll_id = $1", [payrollId])).rejects.toThrow(/finalized/);

        const slips = await api().get("/api/hr/me/payslips").set(waiter);
        expect(slips.body.data).toHaveLength(1);
        expect(Number(slips.body.data[0].net_pay)).toBe(1_637_500);
    });

    it("tháng hiện tại chưa kết thúc thì chưa chốt được", async () => {
        const res = await api().post("/api/hr/payrolls/calculate").set(manager).send({ month: today().slice(0, 7) });
        expect(res.status).toBe(200);
        expect((await api().post(`/api/hr/payrolls/${res.body.data.id}/finalize`).set(manager)).status).toBe(400);
    });

    it("báo cáo lợi nhuận trừ chi phí nhân công của bảng lương", async () => {
        const { start, end } = { start: prevDay(1), end: new Date(Date.UTC(Number(prevMonth().slice(0, 4)), Number(prevMonth().slice(5, 7)), 0)).toISOString().slice(0, 10) };
        const res = await api().get(`/api/reports/profit?from=${start}&to=${end}&group_by=month`).set(manager);
        expect(res.status).toBe(200);
        // Không có tip: chi phí nhân công = tổng thực lĩnh (phục vụ + thu ngân)
        expect(res.body.data.totals.labor_cost).toBeCloseTo(1_637_500 + 120_000, 0);
        expect(res.body.data.totals.net_profit).toBeCloseTo(res.body.data.totals.gross_profit - res.body.data.totals.labor_cost, 1);
        expect(res.body.data.by_restaurant[0]).toMatchObject({ restaurant_id: f.r1 });
        expect(res.body.data.payrolls[0]).toMatchObject({ status: "finalized" });
    });
});

describe("Các API đọc", () => {
    it("mọi endpoint đọc của quản lý và nhân viên trả 200", async () => {
        const month = prevMonth();
        const range = `from=${plusDays(-7)}&to=${plusDays(30)}`;
        const managerPaths = [
            "/api/hr/settings",
            "/api/hr/staff?include_inactive=true",
            "/api/hr/shift-templates",
            `/api/hr/shifts?${range}`,
            "/api/hr/shift-swaps",
            "/api/hr/shift-swaps?status=approved",
            `/api/hr/attendance?${range}&overtime_status=approved`,
            "/api/hr/leaves",
            `/api/hr/leaves?status=approved&from=${prevDay(1)}&to=${today()}`,
            `/api/hr/performance?month=${month}`,
            `/api/hr/adjustments?month=${month}`,
            "/api/hr/payrolls",
            `/api/hr/payrolls?year=${month.slice(0, 4)}`,
            `/api/hr/employees/${f.users.waiter.userId}/compensations`,
            `/api/hr/employees/${f.users.waiter.userId}/allowances`,
        ];
        for (const path of managerPaths) {
            const res = await api().get(path).set(manager);
            expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(200);
        }
        const templates = await api().get("/api/hr/shift-templates").set(manager);
        expect(templates.body.data.map((t: { name: string }) => t.name)).toEqual(["Ca sáng", "Ca đêm"]);

        const selfPaths = [
            "/api/hr/me/status",
            `/api/hr/me/attendance?month=${month}`,
            `/api/hr/me/shifts?${range}`,
            "/api/hr/me/colleagues",
            `/api/hr/me/colleague-shifts?user_id=${waiterB.userId}&${range}`,
            "/api/hr/me/swaps",
            "/api/hr/me/leaves",
            "/api/hr/me/payslips",
        ];
        for (const path of selfPaths) {
            const res = await api().get(path).set(waiter);
            expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(200);
        }
    });
});

describe("Hiệu suất và đánh giá", () => {
    it("giám sát đánh giá nhân viên; hiệu suất có số liệu chấm công và đánh giá", async () => {
        const res = await api().put("/api/hr/reviews").set(supervisor).send({ user_id: f.users.waiter.userId, month: prevMonth(), rating: 4, comment: "Chăm chỉ" });
        expect(res.status).toBe(200);
        expect((await api().put("/api/hr/reviews").set(supervisor).send({ user_id: f.users.manager.userId, month: prevMonth(), rating: 1 })).status).toBe(403);
        const perf = await api().get(`/api/hr/performance?month=${prevMonth()}`).set(manager);
        expect(perf.status).toBe(200);
        const row = perf.body.data.find((p: { user_id: number }) => p.user_id === f.users.waiter.userId);
        expect(row).toMatchObject({ work_days: 3, scheduled_shifts: 3, absent_shifts: 0, leave_days: 2 });
        expect(row.review.rating).toBe(4);
    });
});
