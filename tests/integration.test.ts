import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "~/config/db";
import { auditLogService, eInvoiceService, paymentGatewayService, reportSummaryService } from "~/services";
import { mockEInvoiceControl } from "~/services/einvoice-providers";
import { buildVietQr, crc16 } from "~/utils/vietqr";
import { api, auditRows, baseFixture, bearer, createDish, createTable, Fixture, q } from "./helpers";

/** Giai đoạn 14: chuyển khoản VietQR + webhook SePay, đối soát, hóa đơn điện tử, tổng hợp báo cáo, phân vùng nhật ký */

const API_KEY = "test-sepay-key";
process.env.SEPAY_WEBHOOK_API_KEY = API_KEY;

let f: Fixture;
let dish: number;
let admin: { Authorization: string };
let cashier: { Authorization: string };
let manager: { Authorization: string };
let txnSeq = 1000;

const TZ = "Asia/Ho_Chi_Minh";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
    f = await baseFixture();
    admin = bearer(f.users.admin.token);
    cashier = bearer(f.users.cashier.token);
    manager = bearer(f.users.manager.token);
    dish = await createDish("Bò nướng", 100000);
});

beforeEach(() => mockEInvoiceControl.reset());

/** Mở order trên một bàn mới, gọi `qty` phần và phục vụ hết. Trả về id order và bàn. */
const servedOrder = async (qty = 1, restaurant: "r1" | "r2" = "r1") => {
    const room = restaurant === "r1" ? f.rooms.hall : f.rooms.r2room;
    const table = await createTable(room, `G-${Math.random().toString(36).slice(2, 7)}`);
    const id = (
        await api().post("/api/orders").set(admin).send({ restaurant_id: f[restaurant], table_ids: [table], guest_count: 2 })
    ).body.data.id as number;
    await api().post(`/api/orders/${id}/rounds`).set(admin).send({ items: [{ dish_id: dish, quantity: qty }] });
    const detail = (await api().get(`/api/orders/${id}`).set(admin)).body.data;
    for (const line of detail.rounds.flatMap((r: any) => r.lines)) {
        for (const s of ["cooking", "ready", "served"]) await api().patch(`/api/orders/dishes/${line.id}/status`).set(admin).send({ status: s });
    }
    return { id, table };
};
const orderStatus = async (id: number) => (await q("SELECT status FROM orders WHERE id = $1", [id]))[0].status;

const configureBank = (restaurantId: number, account = "0123456789") =>
    q(
        `UPDATE restaurants SET bank_bin = '970436', bank_account_no = $2, bank_account_name = 'NHA HANG MOT',
            transfer_qr_enabled = true WHERE id = $1`,
        [restaurantId, account],
    );

const webhook = (body: Record<string, unknown>, key = API_KEY) =>
    api()
        .post("/api/payment-gateway/webhooks/sepay")
        .set({ Authorization: `Apikey ${key}` })
        .send({
            id: ++txnSeq,
            gateway: "Vietcombank",
            transactionDate: "2026-11-09 12:00:00",
            accountNumber: "0123456789",
            code: null,
            transferType: "in",
            referenceCode: `FT${txnSeq}`,
            description: "",
            accumulated: 0,
            ...body,
        });

describe("VietQR", () => {
    it("chuỗi EMVCo đúng cấu trúc và CRC", () => {
        const payload = buildVietQr({ bankBin: "970436", accountNo: "0123456789", amount: 150000, content: "RMPABCD2345 Bàn số 1" });
        expect(payload.startsWith("000201010212")).toBe(true);
        expect(payload).toContain("0010A000000727");
        expect(payload).toContain("0006970436");
        expect(payload).toContain("01100123456789");
        expect(payload).toContain("5406150000");
        expect(payload).toContain("5303704");
        // Nội dung bỏ dấu và ký tự đặc biệt
        expect(payload).toContain("RMPABCD2345 Ban so 1");
        expect(payload.slice(-4)).toBe(crc16(payload.slice(0, -4)));
    });
});

describe("Thanh toán chuyển khoản QR + webhook SePay", () => {
    it("chưa khai báo tài khoản nhận thì không tạo được QR", async () => {
        const { id } = await servedOrder();
        const res = await api().post(`/api/orders/${id}/payments/qr`).set(cashier).send({});
        expect(res.status).toBe(400);
    });

    it("tạo QR cho số còn lại; gọi lại cùng số tiền dùng lại mã; đổi số tiền thì mã cũ bị hủy", async () => {
        await configureBank(f.r1);
        const { id } = await servedOrder(2); // 200.000
        const first = await api().post(`/api/orders/${id}/payments/qr`).set(cashier).send({});
        expect(first.status).toBe(201);
        expect(first.body.data.payment).toMatchObject({ status: "processing", method: "transfer", provider: "sepay" });
        expect(first.body.data.qr.amount).toBe(200000);
        expect(first.body.data.qr.content).toContain(first.body.data.payment.gateway_ref);

        const again = await api().post(`/api/orders/${id}/payments/qr`).set(cashier).send({});
        expect(again.body.data.payment.id).toBe(first.body.data.payment.id);

        const partial = await api().post(`/api/orders/${id}/payments/qr`).set(cashier).send({ amount: 50000 });
        expect(partial.status).toBe(201);
        expect(partial.body.data.payment.id).not.toBe(first.body.data.payment.id);
        const [old] = await q("SELECT status FROM payments WHERE id = $1", [first.body.data.payment.id]);
        expect(old.status).toBe("cancelled");
        expect((await api().post(`/api/orders/${id}/payments/qr`).set(cashier).send({ amount: 250000 })).status).toBe(400);
    });

    it("webhook sai khóa bị từ chối; đúng mã và số tiền thì thu tiền, order tự hoàn tất; gửi lại không cộng hai lần", async () => {
        const { id } = await servedOrder(1);
        const qr = (await api().post(`/api/orders/${id}/payments/qr`).set(cashier).send({})).body.data;
        expect((await webhook({ content: qr.qr.content, transferAmount: 100000 }, "wrong")).status).toBe(401);

        const body = { id: 555001, content: `MBVCB.123.${qr.qr.content.toLowerCase()}.CT tu 0011`, transferAmount: 100000 };
        const res = await webhook(body);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe("matched");
        const [p] = await q("SELECT status, reference, paid_at FROM payments WHERE id = $1", [qr.payment.id]);
        expect(p.status).toBe("paid");
        expect(p.reference).toMatch(/^FT/);
        expect(await orderStatus(id)).toBe("completed");

        const dup = await webhook(body);
        expect(dup.status).toBe(200);
        expect(dup.body.data.status).toBe("duplicate");
        expect(await q("SELECT 1 FROM payments WHERE order_id = $1 AND status = 'paid'", [id])).toHaveLength(1);
    });

    it("sai số tiền -> mismatch, payment vẫn chờ; tiền ra -> bỏ qua", async () => {
        const { id } = await servedOrder(1);
        const qr = (await api().post(`/api/orders/${id}/payments/qr`).set(cashier).send({})).body.data;
        const res = await webhook({ content: qr.qr.content, transferAmount: 90000 });
        expect(res.body.data.status).toBe("mismatch");
        const [p] = await q("SELECT status FROM payments WHERE id = $1", [qr.payment.id]);
        expect(p.status).toBe("processing");
        const out = await webhook({ content: "chi tien", transferAmount: 5000, transferType: "out" });
        expect(out.body.data.status).toBe("ignored");
    });

    it("mã hết hạn bị hủy; khách chuyển muộn vẫn được ghi nhận nếu order còn nợ đúng số đó", async () => {
        const { id } = await servedOrder(1);
        const qr = (await api().post(`/api/orders/${id}/payments/qr`).set(cashier).send({})).body.data;
        await q("UPDATE payments SET expires_at = NOW() - interval '1 minute' WHERE id = $1", [qr.payment.id]);
        expect((await paymentGatewayService.expireQrPayments()).expired).toBeGreaterThanOrEqual(1);
        const [p] = await q("SELECT status FROM payments WHERE id = $1", [qr.payment.id]);
        expect(p.status).toBe("cancelled");

        const res = await webhook({ content: qr.qr.content, transferAmount: 100000 });
        expect(res.body.data.status).toBe("matched");
        expect(await orderStatus(id)).toBe("completed");
        const [t] = await q("SELECT note FROM gateway_transactions WHERE id = $1", [res.body.data.transaction_id]);
        expect(t.note).toBe("late_payment");
    });

    it("giao dịch không có mã -> đối soát tay: ghi vào order, không xử lý lại; bỏ qua; phạm vi chi nhánh", async () => {
        const { id } = await servedOrder(1);
        const unknown = await webhook({ content: "chuyen tien an trua", transferAmount: 100000 });
        expect(unknown.body.data.status).toBe("unmatched");
        const txnId = unknown.body.data.transaction_id;

        const list = await api().get("/api/payment-gateway/transactions?status=open").set(cashier);
        expect(list.status).toBe(200);
        expect(list.body.data.transactions.map((t: any) => t.id)).toContain(txnId);
        expect(list.body.data.counts.unmatched).toBeGreaterThanOrEqual(1);
        // Phục vụ không có quyền đối soát
        expect((await api().get("/api/payment-gateway/transactions").set(bearer(f.users.waiter.token))).status).toBe(403);
        // Quản lý chi nhánh 2 không thấy giao dịch của tài khoản chi nhánh 1
        const other = await api().get("/api/payment-gateway/transactions").set(bearer(f.users.manager2.token));
        expect(other.body.data.transactions.map((t: any) => t.id)).not.toContain(txnId);
        expect((await api().post(`/api/payment-gateway/transactions/${txnId}/apply`).set(bearer(f.users.manager2.token)).send({ order_id: id })).status).toBe(404);

        const applied = await api().post(`/api/payment-gateway/transactions/${txnId}/apply`).set(cashier).send({ order_id: id });
        expect(applied.status).toBe(200);
        expect(applied.body.data).toMatchObject({ status: "matched", order_id: id });
        expect(await orderStatus(id)).toBe("completed");
        expect((await auditRows("payment.reconcile")).length).toBe(1);
        expect((await api().post(`/api/payment-gateway/transactions/${txnId}/apply`).set(cashier).send({ order_id: id })).status).toBe(409);

        const junk = await webhook({ content: "hoan tien ncc", transferAmount: 1000 });
        const ignored = await api().post(`/api/payment-gateway/transactions/${junk.body.data.transaction_id}/ignore`).set(cashier).send({ note: "không phải tiền khách" });
        expect(ignored.body.data.status).toBe("ignored");
    });

    it("trang bàn công khai: xem số còn phải trả và tự tạo mã chuyển khoản", async () => {
        const { id, table } = await servedOrder(1);
        const [t] = await q("SELECT qr_token FROM tables WHERE id = $1", [table]);
        const page = await api().get(`/api/public/tables/${t.qr_token}`);
        expect(page.body.data.order.payment).toMatchObject({ remaining: 100000, transfer_qr_enabled: true, qr: null });

        const created = await api().post(`/api/public/tables/${t.qr_token}/payment-qr`).send({});
        expect(created.status).toBe(201);
        expect(created.body.data.qr.amount).toBe(100000);
        const again = await api().get(`/api/public/tables/${t.qr_token}`);
        expect(again.body.data.order.payment.qr.payment_id).toBe(created.body.data.payment.id);

        await webhook({ content: created.body.data.qr.content, transferAmount: 100000 });
        expect(await orderStatus(id)).toBe("completed");
    });
});

describe("Hóa đơn điện tử", () => {
    const issue = (orderId: number, body: Record<string, unknown> = {}, who = cashier) =>
        api().post(`/api/orders/${orderId}/e-invoice`).set(who).send(body);

    const paidOrder = async (qty = 1) => {
        const { id } = await servedOrder(qty);
        await api().post(`/api/orders/${id}/payments`).set(cashier).send({ method: "cash", amount: qty * 100000 });
        return id;
    };

    it("chỉ phát hành cho order đã hoàn tất, khi nhà hàng đã khai báo người bán", async () => {
        const { id: open } = await servedOrder(1);
        expect((await issue(open)).status).toBe(400);
        const done = await paidOrder();
        const res = await issue(done);
        expect(res.status).toBe(400);
        expect(res.body.message).toBeTruthy();
    });

    it("phát hành cho khách lẻ và doanh nghiệp; trùng thì 409; hủy rồi phát hành lại được số mới", async () => {
        await q(
            "UPDATE restaurants SET legal_name = 'Công ty TNHH Nhà Hàng Một', tax_code = '0312345678', einvoice_series = '1C26TAA' WHERE id = $1",
            [f.r1],
        );
        const id = await paidOrder(2);
        const res = await issue(id, { buyer_type: "individual", buyer_name: "Nguyễn Văn A", buyer_email: "a@example.com" });
        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ status: "issued", series: "1C26TAA", invoice_no: "00000001", total: "200000.00" });
        expect(res.body.data.lines).toEqual([expect.objectContaining({ kind: "item", quantity: 2, amount: 200000 })]);
        expect(res.body.data.seller.tax_code).toBe("0312345678");
        expect((await issue(id)).status).toBe(409);

        const invoice = (await api().get(`/api/orders/${id}/invoice`).set(cashier)).body.data;
        expect(invoice.e_invoice).toMatchObject({ status: "issued", invoice_no: "00000001" });

        // Thu ngân không có quyền hủy
        expect((await api().post(`/api/e-invoices/${res.body.data.id}/cancel`).set(cashier).send({ reason: "sai" })).status).toBe(403);
        const cancelled = await api().post(`/api/e-invoices/${res.body.data.id}/cancel`).set(manager).send({ reason: "Khách đổi thông tin" });
        expect(cancelled.status).toBe(200);
        expect(cancelled.body.data.status).toBe("cancelled");
        expect(mockEInvoiceControl.cancelled).toContain(res.body.data.id);

        const company = { buyer_type: "company", buyer_company: "Công ty ABC" };
        expect((await issue(id, company)).status).toBe(400);
        const reissued = await issue(id, { ...company, buyer_tax_code: "0101234567", buyer_address: "Hà Nội" });
        expect(reissued.status).toBe(201);
        expect(reissued.body.data.invoice_no).toBe("00000002");
        expect((await auditRows("einvoice.issue")).length).toBe(2);
        expect((await auditRows("einvoice.cancel")).length).toBe(1);
    });

    it("nhà cung cấp lỗi -> failed, hẹn thử lại; thử lại tay thành công", async () => {
        const id = await paidOrder();
        mockEInvoiceControl.failNext = 1;
        const res = await issue(id);
        expect(res.status).toBe(201);
        expect(res.body.data.status).toBe("failed");
        expect(res.body.data.error_message).toBeTruthy();
        expect(res.body.data.next_retry_at).toBeTruthy();
        const retried = await api().post(`/api/e-invoices/${res.body.data.id}/retry`).set(cashier);
        expect(retried.body.data.status).toBe("issued");
    });

    it("tự phát hành khi order hoàn tất; job gửi hàng chờ; danh sách theo chi nhánh", async () => {
        await q("UPDATE restaurants SET einvoice_auto_issue = true WHERE id = $1", [f.r1]);
        const id = await paidOrder();
        const [row] = await q("SELECT id, status, source FROM e_invoices WHERE order_id = $1", [id]);
        expect(row).toMatchObject({ status: "pending", source: "auto" });
        const result = await eInvoiceService.dispatchDue();
        expect(result.issued).toBeGreaterThanOrEqual(1);
        const [after] = await q("SELECT status, buyer_name FROM e_invoices WHERE id = $1", [row.id]);
        expect(after.status).toBe("issued");
        await q("UPDATE restaurants SET einvoice_auto_issue = false WHERE id = $1", [f.r1]);

        const list = await api().get(`/api/e-invoices?order_id=${id}`).set(cashier);
        expect(list.body.data.e_invoices).toHaveLength(1);
        const other = await api().get("/api/e-invoices").set(bearer(f.users.manager2.token));
        expect(other.body.data.e_invoices).toHaveLength(0);
    });
});

describe("Tổng hợp doanh thu theo ngày", () => {
    it("báo cáo trước và sau khi tổng hợp giống nhau; payment ghi lùi ngày làm mốc lùi lại", async () => {
        const y = shift(today(), -1);
        const [o] = await q(
            `INSERT INTO orders (code, restaurant_id, guest_count, status, subtotal, total, created_at, completed_at)
            VALUES ('SUM-1', $1, 2, 'completed', 80000, 80000, NOW() - interval '1 day', NOW() - interval '1 day') RETURNING id`,
            [f.r2],
        );
        await q(
            `INSERT INTO payments (order_id, restaurant_id, type, method, amount, status, paid_at, tip_amount)
            VALUES ($1, $2, 'payment', 'card', 80000, 'paid', (($3::date + time '12:00') AT TIME ZONE '${TZ}'), 5000)`,
            [o.id, f.r2, y],
        );
        const url = `/api/reports/revenue?from=${shift(today(), -3)}&to=${today()}&group_by=day`;
        const overviewUrl = `/api/reports/overview?from=${shift(today(), -3)}&to=${today()}`;
        const before = (await api().get(url).set(admin)).body.data;
        const overviewBefore = (await api().get(overviewUrl).set(admin)).body.data.current;

        const refreshed = await reportSummaryService.refreshDailySummary();
        expect(refreshed.through).toBe(y);
        const [summary] = await q("SELECT collected, tips FROM report_daily_payments WHERE restaurant_id = $1 AND day = $2", [f.r2, y]);
        expect(summary).toMatchObject({ collected: "80000.00", tips: "5000.00" });

        const after = (await api().get(url).set(admin)).body.data;
        expect(after.series).toEqual(before.series);
        expect(after.by_method).toEqual(before.by_method);
        expect(after.totals).toEqual(before.totals);
        expect((await api().get(overviewUrl).set(admin)).body.data.current).toEqual(overviewBefore);

        // Payment ghi vào ngày đã tổng hợp: mốc lùi về trước ngày đó, báo cáo vẫn đúng ngay
        const [original] = await q("SELECT id FROM payments WHERE order_id = $1", [o.id]);
        await q(
            `INSERT INTO payments (order_id, restaurant_id, type, method, amount, status, paid_at, refund_of_payment_id)
            VALUES ($1, $2, 'refund', 'card', 10000, 'paid', (($3::date + time '13:00') AT TIME ZONE '${TZ}'), $4)`,
            [o.id, f.r2, y, original.id],
        );
        const [state] = await q("SELECT payments_through::text AS through FROM report_summary_state WHERE id = 1");
        expect(state.through).toBe(shift(y, -1));
        const changed = (await api().get(url).set(admin)).body.data;
        expect(changed.totals.refunded).toBe(before.totals.refunded + 10000);
        await reportSummaryService.refreshDailySummary();
        expect((await api().get(url).set(admin)).body.data.totals).toEqual(changed.totals);
    });
});

describe("Vận hành", () => {
    it("health và readiness", async () => {
        const live = await api().get("/api/health");
        expect(live.status).toBe(200);
        expect(live.body.status).toBe("ok");
        const ready = await api().get("/api/health/ready");
        expect(ready.status).toBe(200);
        expect(ready.body.database).toBe("ok");
        expect(live.headers["x-request-id"]).toBeUndefined();
        expect((await api().get("/api/restaurants/all")).headers["x-request-id"]).toBeTruthy();
    });

    it("nhật ký phân vùng theo tháng: ghi vào phân vùng tháng hiện tại, vẫn chỉ cho thêm; bảo trì phân vùng chạy được", async () => {
        const [row] = await q(
            "INSERT INTO audit_logs (action, entity_type) VALUES ('test.partition', 'test') RETURNING id, tableoid::regclass::text AS part",
        );
        expect(row.part).toMatch(/^audit_logs_p\d{6}$/);
        await expect(pool.query("UPDATE audit_logs SET action = 'x' WHERE id = $1", [row.id])).rejects.toThrow(/append-only/);
        await expect(pool.query(`DELETE FROM ${row.part} WHERE id = $1`, [row.id])).rejects.toThrow(/append-only/);
        const result = await auditLogService.maintainAuditPartitions();
        expect(result).toMatchObject({ created: expect.any(Number), dropped: expect.any(Number) });
        const parts = await q("SELECT count(*)::int AS n FROM pg_inherits i JOIN pg_class p ON p.oid = i.inhparent WHERE p.relname = 'audit_logs'");
        expect(parts[0].n).toBeGreaterThanOrEqual(5);
    });
});
