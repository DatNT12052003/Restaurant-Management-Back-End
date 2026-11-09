import { randomInt } from "crypto";
import { PaymentMethodEnum, PaymentStatusEnum, PaymentTypeEnum } from "~/common/enum";
import { GATEWAY_ERROR, PAYMENT_ERROR } from "~/common/error-code/payment";
import { QR_PAYMENT_MINUTES } from "~/common/constant";
import { rollback, withTransaction } from "~/config/db";
import logger from "~/config/logger";
import {
    GatewayTransactionStatus,
    IAuditContext,
    IGatewayAccount,
    IGetGatewayTransactions,
    IGatewayTransaction,
    INormalizedTransfer,
    IOrder,
    IPayment,
    IQrInfo,
    IQrPayment,
    ISelectQuery,
} from "~/interfaces";
import { customerRepository, gatewayRepository, orderRepository, paymentRepository, restaurantRepository } from "~/repositories";
import { OPEN_ORDER_STATUSES } from "~/repositories/order.repository";
import { emitToRestaurant } from "~/sockets";
import { writeAudit } from "~/utils/audit";
import { roundVnd } from "~/utils/billing";
import { buildPagination } from "~/utils/pagination";
import { buildVietQr, sanitizeTransferContent } from "~/utils/vietqr";
import * as sepay from "./gateways/sepay";
import * as orderService from "./order.service";
import { emitPaymentChanged } from "./payment.service";
import { inScope } from "./room.service";

/**
 * Giai đoạn 14: thanh toán chuyển khoản VietQR, xác nhận tự động qua webhook SePay (câu hỏi 12).
 *
 * - Payment QR: `transfer`, `processing`, mã đối soát `gateway_ref` nằm trong nội dung chuyển khoản, hết hạn sau
 *   `QR_PAYMENT_MINUTES`. Mỗi order có tối đa một mã đang hiệu lực: tạo mã mới thì mã cũ bị hủy.
 * - Webhook: đúng mã + đúng số tiền -> payment `paid` (order tự hoàn tất nếu đủ điều kiện). Mã đã hết hạn / bị thay mà
 *   order vẫn còn nợ đúng số đó -> vẫn ghi nhận. Còn lại -> `unmatched` / `mismatch` để đối soát tay.
 */

type Scope = number | null | undefined;

const P = PaymentStatusEnum;
/** Bảng chữ không dễ nhầm (bỏ 0/O, 1/I) */
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const REF_LENGTH = 8;

const refPrefix = () => (process.env.PAYMENT_REF_PREFIX || "RMP").toUpperCase().replace(/[^A-Z0-9]/g, "") || "RMP";

const newRef = () => {
    let s = refPrefix();
    for (let i = 0; i < REF_LENGTH; i++) s += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
    return s;
};

/** Tìm mã đối soát trong nội dung (ngân hàng có thể chèn thêm chữ, bỏ khoảng trắng hoặc viết thường) */
export const extractRef = (...texts: (string | null | undefined)[]): string | null => {
    const pattern = new RegExp(`${refPrefix()}[${REF_ALPHABET}]{${REF_LENGTH}}`);
    for (const text of texts) {
        if (!text) continue;
        const upper = text.toUpperCase();
        const found = pattern.exec(upper) ?? pattern.exec(upper.replace(/[^A-Z0-9]/g, ""));
        if (found) return found[0];
    }
    return null;
};

const transferContent = (ref: string, orderCode: string) => sanitizeTransferContent(`${ref} ${orderCode}`);

export const qrInfoOf = (payment: IPayment): IQrInfo | null => {
    const account = payment.gateway_data;
    if (!account || !payment.gateway_ref) return null;
    const content = transferContent(payment.gateway_ref, payment.order_code ?? "");
    const amount = Number(payment.amount);
    return {
        payload: buildVietQr({ bankBin: account.bank_bin, accountNo: account.account_no, amount, content }),
        bank_bin: account.bank_bin,
        account_no: account.account_no,
        account_name: account.account_name,
        amount,
        content,
        expires_at: payment.expires_at ?? null,
    };
};

const accountOf = (r: { bank_bin?: string | null; bank_account_no?: string | null; bank_account_name?: string | null; transfer_qr_enabled?: boolean }): IGatewayAccount | null =>
    r.transfer_qr_enabled && r.bank_bin && r.bank_account_no
        ? { bank_bin: r.bank_bin, account_no: r.bank_account_no, account_name: r.bank_account_name ?? null }
        : null;

const isOpen = (order: IOrder) => OPEN_ORDER_STATUSES.includes(order.status);

// ---------------------------------------------------------------------------
// Tạo mã QR
// ---------------------------------------------------------------------------

/**
 * Tạo (hoặc dùng lại) payment QR cho order đang mở. Gọi trong transaction, order đã khóa.
 * `amount` bỏ trống = toàn bộ số còn phải thu (không tính mã QR đang mở, vì mã đó sẽ bị thay).
 */
const issueQr = async (order: IOrder, amount: number | undefined, actorId: number | null) => {
    const restaurant = await restaurantRepository.getRestaurantById(order.restaurant_id);
    const account = restaurant ? accountOf(restaurant) : null;
    if (!account) return rollback(PAYMENT_ERROR.QR_NOT_CONFIGURED);

    const open = await paymentRepository.getOpenQrPayments(order.id);
    const summary = await paymentRepository.getSummary(order.id);
    const openSum = open.reduce((s, p) => s + Number(p.amount), 0);
    const due = roundVnd(Number(order.total) - summary.paid - (summary.pending - openSum));
    if (due <= 0) return rollback(PAYMENT_ERROR.NOTHING_DUE);
    const want = roundVnd(amount ?? due);
    if (want <= 0) return rollback(PAYMENT_ERROR.NOTHING_DUE);
    if (want > due) return rollback(PAYMENT_ERROR.AMOUNT_EXCEEDS_DUE);

    // Mã đang mở cùng số tiền, cùng tài khoản và còn hạn ít nhất 2 phút: dùng lại (khách có thể đã quét)
    const now = Date.now();
    const reusable = open.find(
        (p) =>
            Number(p.amount) === want &&
            p.gateway_data?.account_no === account.account_no &&
            p.gateway_data?.bank_bin === account.bank_bin &&
            p.expires_at &&
            new Date(p.expires_at).getTime() - now > 2 * 60_000,
    );
    const cancelled = await paymentRepository.cancelQrPayments(
        open.filter((p) => p !== reusable).map((p) => p.id),
        "replaced",
    );
    if (reusable) return { id: reusable.id, cancelled, created: false };

    const created = await paymentRepository.createPayment({
        order_id: order.id,
        restaurant_id: order.restaurant_id,
        type: PaymentTypeEnum.PAYMENT,
        method: PaymentMethodEnum.TRANSFER,
        amount: want,
        status: P.PROCESSING,
        provider: sepay.SEPAY,
        gateway_ref: newRef(),
        gateway_data: account,
        expires_at: new Date(now + QR_PAYMENT_MINUTES * 60_000),
        cashier_id: actorId,
        tip_amount: 0,
    });
    return { id: created.id, cancelled, created: true };
};

const loadOpenOrder = async (orderId: number, scope: Scope): Promise<IOrder> => {
    const order = await orderRepository.getOrderRow(orderId, true);
    if (!order || !inScope(order.restaurant_id, scope)) return rollback(PAYMENT_ERROR.ORDER_NOT_FOUND);
    if (!isOpen(order)) return rollback(PAYMENT_ERROR.ORDER_CLOSED);
    return order;
};

const emitIssued = (order: IOrder, result: { id: number; cancelled: number[]; created: boolean }) => {
    for (const id of result.cancelled) emitPaymentChanged(order, id, P.CANCELLED, null);
    if (result.created) emitPaymentChanged(order, result.id, P.PROCESSING, null);
};

/** Thu ngân tạo mã QR cho order (`payment.create`) */
export const createQrPayment = async (
    orderId: number,
    amount: number | undefined,
    scope: Scope,
    actorId: number | undefined,
): Promise<IQrPayment | number> => {
    try {
        const result = await withTransaction(async () => {
            const order = await loadOpenOrder(orderId, scope);
            return { order, issued: await issueQr(order, amount, actorId ?? null) };
        });
        if (typeof result === "number") return result;
        emitIssued(result.order, result.issued);
        const payment = (await paymentRepository.getPaymentById(result.issued.id))!;
        return { payment, qr: qrInfoOf(payment)! };
    } catch (error) {
        logger.error("createQrPayment failed", { error: (error as Error).message });
        return PAYMENT_ERROR.FAILED;
    }
};

/** Trang QR của bàn: khách tự tạo mã để trả toàn bộ số còn lại của order đang mở */
export const createQrForTable = async (token: string): Promise<IQrPayment | number> => {
    try {
        const table = await customerRepository.getTableByToken(token);
        if (!table) return PAYMENT_ERROR.ORDER_NOT_FOUND;
        const orderId = await orderRepository.getOpenOrderIdByTable(table.id);
        if (!orderId) return PAYMENT_ERROR.ORDER_NOT_FOUND;
        return await createQrPayment(orderId, undefined, null, undefined);
    } catch (error) {
        return PAYMENT_ERROR.FAILED;
    }
};

/** Thông tin thanh toán cho trang bàn công khai */
export const getPublicPayment = async (orderId: number) => {
    const order = await orderRepository.getOrderRow(orderId);
    if (!order) return null;
    const [restaurant, summary, open] = await Promise.all([
        restaurantRepository.getRestaurantById(order.restaurant_id),
        paymentRepository.getSummary(orderId),
        paymentRepository.getOpenQrPayments(orderId),
    ]);
    const now = Date.now();
    const active = open.find((p) => p.expires_at && new Date(p.expires_at).getTime() > now);
    return {
        total: Number(order.total),
        paid: summary.paid,
        remaining: roundVnd(Number(order.total) - summary.paid),
        transfer_qr_enabled: Boolean(restaurant && accountOf(restaurant)),
        qr: active ? { ...qrInfoOf(active)!, payment_id: active.id } : null,
    };
};

/** Job mỗi phút: hủy mã QR quá hạn để order không bị treo ở "đang chờ thanh toán" */
export const expireQrPayments = async () => {
    const expired = await withTransaction(() => paymentRepository.expireQrPayments());
    for (const p of expired) {
        emitToRestaurant(p.restaurant_id, "payment:changed", {
            restaurant_id: p.restaurant_id,
            order_id: p.order_id,
            payment_id: p.id,
            status: P.CANCELLED,
        });
    }
    return { expired: expired.length };
};

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

type WebhookResult = { transaction_id: number | null; status: GatewayTransactionStatus | "duplicate" };

/** Ghi nhận payment QR đã nhận tiền. Gọi trong transaction, order và payment đã khóa. */
const markPaid = async (payment: IPayment, order: IOrder, bankReference: string | null) => {
    await paymentRepository.updatePayment(payment.id, {
        status: P.PAID,
        paid_at: new Date(),
        reference: bankReference ?? payment.gateway_ref ?? null,
    });
    return orderService.completeIfSettled(order);
};

/** Xử lý một giao dịch đã chuẩn hóa (dùng chung cho mọi cổng) */
export const processTransfer = async (t: INormalizedTransfer): Promise<WebhookResult> => {
    const result = await withTransaction(async () => {
        const inserted = await gatewayRepository.insertTransaction(t, "unmatched");
        if (!inserted) return { transaction_id: null, status: "duplicate" as const };
        const txnId = inserted.id;
        const restaurantByAccount = await gatewayRepository.getRestaurantByAccount(t.account_number);

        if (t.direction === "out") {
            await gatewayRepository.updateTransaction(txnId, { status: "ignored", note: "outgoing", restaurant_id: restaurantByAccount });
            return { transaction_id: txnId, status: "ignored" as const };
        }

        const ref = extractRef(t.code, t.content);
        const found = ref ? await paymentRepository.getPaymentByGatewayRef(ref) : undefined;
        if (!found) {
            await gatewayRepository.updateTransaction(txnId, {
                restaurant_id: restaurantByAccount,
                matched_ref: ref,
                note: ref ? "unknown_ref" : "no_ref",
            });
            return { transaction_id: txnId, status: "unmatched" as const, restaurantId: restaurantByAccount };
        }

        // Khóa theo thứ tự order -> payment như các thao tác thanh toán khác
        const order = (await orderRepository.getOrderRow(found.order_id, true))!;
        const payment = (await paymentRepository.getPaymentById(found.id, true))!;
        const base = { restaurant_id: payment.restaurant_id, matched_ref: ref, order_id: order.id, payment_id: payment.id };
        const amount = roundVnd(t.amount);
        const exact = amount === roundVnd(Number(payment.amount));

        let status: GatewayTransactionStatus = "unmatched";
        let note: string | null = null;
        let closed: Awaited<ReturnType<typeof markPaid>> = null;
        let paid = false;

        if (payment.status === P.PROCESSING || payment.status === P.PENDING) {
            if (exact && isOpen(order)) {
                closed = await markPaid(payment, order, t.bank_reference);
                status = "matched";
                paid = true;
            } else {
                status = exact ? "unmatched" : "mismatch";
                note = exact ? "order_closed" : "amount_mismatch";
            }
        } else if (payment.status === P.CANCELLED && isOpen(order)) {
            // Mã đã hết hạn / bị thay: vẫn nhận nếu order còn nợ đúng số tiền này
            const summary = await paymentRepository.getSummary(order.id);
            const open = await paymentRepository.getOpenQrPayments(order.id);
            const openSum = open.reduce((s, p) => s + Number(p.amount), 0);
            const due = roundVnd(Number(order.total) - summary.paid - (summary.pending - openSum));
            if (exact && amount <= due) {
                await paymentRepository.cancelQrPayments(
                    open.map((p) => p.id),
                    "replaced",
                );
                closed = await markPaid(payment, order, t.bank_reference);
                status = "matched";
                note = "late_payment";
                paid = true;
            } else {
                status = exact ? "unmatched" : "mismatch";
                note = exact ? "payment_cancelled" : "amount_mismatch";
            }
        } else {
            note = payment.status === P.PAID || payment.status === P.REFUNDED ? "already_paid" : "order_closed";
        }

        await gatewayRepository.updateTransaction(txnId, { ...base, status, note });
        return { transaction_id: txnId, status, order, paymentId: payment.id, paid, closed, restaurantId: payment.restaurant_id };
    });

    if ("order" in result && result.order && result.paid) {
        emitPaymentChanged(result.order, result.paymentId!, P.PAID, result.closed ?? null);
    }
    if ((result.status === "unmatched" || result.status === "mismatch") && "restaurantId" in result && result.restaurantId) {
        emitToRestaurant(result.restaurantId, "gateway:transaction", {
            restaurant_id: result.restaurantId,
            transaction_id: result.transaction_id,
            status: result.status,
        });
    }
    return { transaction_id: result.transaction_id, status: result.status };
};

/** Webhook SePay: xác thực khóa API, chuẩn hóa payload rồi xử lý */
export const handleSepayWebhook = async (authorization: string | undefined, body: unknown): Promise<WebhookResult | number> => {
    if (!sepay.verify(authorization)) return GATEWAY_ERROR.UNAUTHORIZED;
    const transfer = sepay.parse(body);
    if (!transfer) return GATEWAY_ERROR.INVALID_PAYLOAD;
    try {
        return await processTransfer(transfer);
    } catch (error) {
        logger.error("SePay webhook failed", { error: (error as Error).message, provider_txn_id: transfer.provider_txn_id });
        return GATEWAY_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// Đối soát
// ---------------------------------------------------------------------------

export const getTransactions = async (params: ISelectQuery, scope: Scope): Promise<IGetGatewayTransactions | number> => {
    try {
        const [result, counts] = await Promise.all([
            gatewayRepository.getTransactions(params),
            gatewayRepository.countOpen(scope ?? null),
        ]);
        return { transactions: result.rows, pagination: buildPagination(params, result.totalCount), counts };
    } catch (error) {
        return GATEWAY_ERROR.FAILED;
    }
};

/** Giao dịch chưa xác định nhà hàng chỉ admin (scope null) thấy được */
const loadOpenTransaction = async (id: number, scope: Scope): Promise<IGatewayTransaction> => {
    const txn = await gatewayRepository.getTransactionById(id, true);
    if (!txn) return rollback(GATEWAY_ERROR.NOT_FOUND);
    if (scope !== null && scope !== undefined && txn.restaurant_id !== scope) return rollback(GATEWAY_ERROR.NOT_FOUND);
    if (txn.status !== "unmatched" && txn.status !== "mismatch") return rollback(GATEWAY_ERROR.ALREADY_RESOLVED);
    return txn;
};

/**
 * Ghi nhận tay một giao dịch vào order đang mở: hủy các mã QR đang mở của order, tạo payment chuyển khoản đã thu
 * đúng số tiền giao dịch (không vượt số còn phải thu). Ghi audit.
 */
export const applyTransaction = async (
    id: number,
    orderId: number,
    scope: Scope,
    audit: IAuditContext,
): Promise<IGatewayTransaction | number> => {
    try {
        const result = await withTransaction(async () => {
            const txn = await loadOpenTransaction(id, scope);
            const order = await orderRepository.getOrderRow(orderId, true);
            if (!order || !inScope(order.restaurant_id, scope)) return rollback(GATEWAY_ERROR.ORDER_NOT_FOUND);
            if (!isOpen(order)) return rollback(GATEWAY_ERROR.ORDER_CLOSED);
            if (txn.restaurant_id !== null && txn.restaurant_id !== order.restaurant_id) {
                return rollback(GATEWAY_ERROR.RESTAURANT_MISMATCH);
            }
            const open = await paymentRepository.getOpenQrPayments(order.id);
            const cancelled = await paymentRepository.cancelQrPayments(
                open.map((p) => p.id),
                "replaced",
            );
            const summary = await paymentRepository.getSummary(order.id);
            const due = roundVnd(Number(order.total) - summary.paid - summary.pending);
            const amount = roundVnd(Number(txn.amount));
            if (amount > due) return rollback(GATEWAY_ERROR.AMOUNT_EXCEEDS_DUE);

            const created = await paymentRepository.createPayment({
                order_id: order.id,
                restaurant_id: order.restaurant_id,
                type: PaymentTypeEnum.PAYMENT,
                method: PaymentMethodEnum.TRANSFER,
                amount,
                status: P.PAID,
                provider: txn.provider,
                reference: txn.bank_reference ?? `${txn.provider}:${txn.provider_txn_id}`,
                note: "reconciled",
                cashier_id: audit.userId ?? null,
                paid_at: new Date(),
                tip_amount: 0,
            });
            const now = new Date();
            await gatewayRepository.updateTransaction(id, {
                status: "matched",
                restaurant_id: order.restaurant_id,
                order_id: order.id,
                payment_id: created.id,
                resolved_by: audit.userId ?? null,
                resolved_at: now,
                note: "manual",
            });
            const closed = await orderService.completeIfSettled(order);
            await writeAudit(audit, {
                action: "payment.reconcile",
                entity_type: "gateway_transaction",
                entity_id: id,
                restaurant_id: order.restaurant_id,
                before: { status: txn.status, amount: txn.amount, content: txn.content },
                after: { status: "matched", order_id: order.id, order_code: order.code, payment_id: created.id },
            });
            return { order, paymentId: created.id, cancelled, closed };
        });
        if (typeof result === "number") return result;
        for (const c of result.cancelled) emitPaymentChanged(result.order, c, P.CANCELLED, null);
        emitPaymentChanged(result.order, result.paymentId, P.PAID, result.closed);
        return (await gatewayRepository.getTransactionById(id))!;
    } catch (error) {
        logger.error("applyTransaction failed", { error: (error as Error).message });
        return GATEWAY_ERROR.FAILED;
    }
};

/** Đánh dấu bỏ qua (không phải tiền của khách, đã xử lý ngoài hệ thống...) */
export const ignoreTransaction = async (
    id: number,
    note: string | null | undefined,
    scope: Scope,
    audit: IAuditContext,
): Promise<IGatewayTransaction | number> => {
    try {
        const result = await withTransaction(async () => {
            const txn = await loadOpenTransaction(id, scope);
            await gatewayRepository.updateTransaction(id, {
                status: "ignored",
                note: note ?? "manual",
                resolved_by: audit.userId ?? null,
                resolved_at: new Date(),
            });
            await writeAudit(audit, {
                action: "payment.reconcile_ignore",
                entity_type: "gateway_transaction",
                entity_id: id,
                restaurant_id: txn.restaurant_id,
                before: { status: txn.status, amount: txn.amount, content: txn.content },
                after: { status: "ignored", note: note ?? null },
            });
            return txn;
        });
        if (typeof result === "number") return result;
        return (await gatewayRepository.getTransactionById(id))!;
    } catch (error) {
        return GATEWAY_ERROR.FAILED;
    }
};

