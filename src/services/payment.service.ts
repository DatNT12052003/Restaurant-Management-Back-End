import { OrderStatusEnum, PaymentMethodEnum, PaymentStatusEnum, PaymentTypeEnum } from "~/common/enum";
import { PAYMENT_ERROR } from "~/common/error-code/payment";
import { rollback, withTransaction } from "~/config/db";
import {
    IAuditContext,
    ICreatePaymentBody,
    IGetPayments,
    IInvoice,
    IOrder,
    IPayment,
    IRefundBody,
    ISelectQuery,
} from "~/interfaces";
import { eInvoiceRepository, orderRepository, paymentRepository, restaurantRepository } from "~/repositories";
import { OPEN_ORDER_STATUSES } from "~/repositories/order.repository";
import { emitToRestaurant } from "~/sockets";
import { writeAudit } from "~/utils/audit";
import { roundVnd } from "~/utils/billing";
import { buildPagination } from "~/utils/pagination";
import * as orderService from "./order.service";
import * as loyaltyService from "./loyalty.service";
import { inScope } from "./room.service";

/** `scope`: null = mọi nhà hàng (admin); số = chỉ nhà hàng này. */
type Scope = number | null | undefined;

const P = PaymentStatusEnum;
const WAITING: PaymentStatusEnum[] = [P.PENDING, P.PROCESSING];

/** Khóa order; ngoài phạm vi coi như không tồn tại. Gọi trong transaction. */
const loadOrder = async (orderId: number, scope: Scope, open = true): Promise<IOrder> => {
    const order = await orderRepository.getOrderRow(orderId, true);
    if (!order || !inScope(order.restaurant_id, scope)) return rollback(PAYMENT_ERROR.ORDER_NOT_FOUND);
    if (open && !OPEN_ORDER_STATUSES.includes(order.status)) return rollback(PAYMENT_ERROR.ORDER_CLOSED);
    return order;
};

/** Khóa payment và order của nó. Gọi trong transaction. */
const loadPayment = async (id: number, scope: Scope): Promise<{ payment: IPayment; order: IOrder }> => {
    const found = await paymentRepository.getPaymentById(id);
    if (!found || !inScope(found.restaurant_id, scope)) return rollback(PAYMENT_ERROR.NOT_FOUND);
    // Khóa theo thứ tự order -> payment (giống lúc tạo payment) để tránh deadlock
    const order = await orderRepository.getOrderRow(found.order_id, true);
    const payment = await paymentRepository.getPaymentById(id, true);
    return { payment: payment!, order: order! };
};

type Closed = Awaited<ReturnType<typeof orderService.completeIfSettled>>;

/** Phát sự kiện sau commit: payment đổi, order đổi tiền / trạng thái (kèm đóng order nếu vừa tự hoàn tất) */
export const emitPaymentChanged = (order: IOrder, paymentId: number, status: PaymentStatusEnum, closed: Closed) => {
    emitToRestaurant(order.restaurant_id, "payment:changed", {
        restaurant_id: order.restaurant_id,
        order_id: order.id,
        payment_id: paymentId,
        status,
    });
    if (closed) orderService.emitClosed(order, OrderStatusEnum.COMPLETED, closed);
    else {
        emitToRestaurant(order.restaurant_id, "order:updated", {
            restaurant_id: order.restaurant_id,
            order_id: order.id,
            code: order.code,
            status: order.status,
        });
    }
};

// ---------------------------------------------------------------------------
// Đọc
// ---------------------------------------------------------------------------

export const getPayments = async (params: ISelectQuery): Promise<IGetPayments | number> => {
    try {
        const [result, sums] = await Promise.all([paymentRepository.getPayments(params), paymentRepository.sumPayments(params)]);
        return {
            payments: result.rows,
            pagination: buildPagination(params, result.totalCount),
            summary: { ...sums, net: (Number(sums.collected) - Number(sums.refunded)).toFixed(2) },
        };
    } catch (error) {
        return PAYMENT_ERROR.FAILED;
    }
};

/** Hóa đơn: dòng món đã gộp, giảm giá, phí, thuế, các lần thanh toán, còn phải thu */
export const getInvoice = async (orderId: number, scope: Scope): Promise<IInvoice | number> => {
    try {
        const order = await orderRepository.getOrderById(orderId);
        if (!order || !inScope(order.restaurant_id, scope)) return PAYMENT_ERROR.ORDER_NOT_FOUND;
        const [lines, payments, restaurant, summary, eInvoice] = await Promise.all([
            paymentRepository.getInvoiceLines(orderId),
            paymentRepository.getOrderPayments(orderId),
            restaurantRepository.getRestaurantById(order.restaurant_id),
            paymentRepository.getSummary(orderId),
            eInvoiceRepository.getActiveByOrder(orderId),
        ]);
        return {
            order: {
                id: order.id,
                code: order.code,
                status: order.status,
                guest_count: order.guest_count,
                created_at: order.created_at,
                completed_at: order.completed_at,
                tables: (order.tables || []).map((t) => t.name),
                staff_name: order.assigned_staff_name ?? order.created_by_name ?? null,
                guest_name: order.guest?.full_name ?? null,
                guest_user_id: order.guest_user_id ?? null,
                guest_phone: order.guest?.phone_number ?? null,
            },
            restaurant: { id: order.restaurant_id, name: restaurant?.name ?? "", address: restaurant?.address ?? "" },
            lines,
            discount: order.discount ? { code: order.discount.code, name: order.discount.name, amount: order.discount.amount } : null,
            subtotal: order.subtotal,
            discount_amount: order.discount_amount,
            service_fee_rate: order.service_fee_rate ?? "0",
            service_fee: order.service_fee ?? "0",
            tax_rate: order.tax_rate ?? "0",
            tax: order.tax ?? "0",
            total: order.total,
            payments,
            paid: summary.paid,
            remaining: roundVnd(Number(order.total) - summary.paid),
            tip_total: Number(order.tip_amount ?? 0),
            // Giai đoạn 13: đổi điểm (tiền giảm nằm trong discount_amount) và điểm đã cộng
            points_redeemed: Number(order.points_redeemed ?? 0),
            points_discount: Number(order.points_discount ?? 0),
            points_awarded: Number(order.points_awarded ?? 0),
            e_invoice: eInvoice
                ? {
                      id: eInvoice.id,
                      status: eInvoice.status,
                      series: eInvoice.series,
                      invoice_no: eInvoice.invoice_no,
                      lookup_code: eInvoice.lookup_code,
                      lookup_url: eInvoice.lookup_url,
                      error_message: eInvoice.error_message,
                  }
                : null,
            // Giai đoạn 14: mã QR chuyển khoản đang mở và tài khoản nhận của nhà hàng
            transfer_qr_enabled: Boolean(restaurant?.transfer_qr_enabled && restaurant.bank_bin && restaurant.bank_account_no),
        };
    } catch (error) {
        return PAYMENT_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// Thu tiền
// ---------------------------------------------------------------------------

/**
 * Thu tiền cho order đang mở (có thể nhiều lần, nhiều phương thức).
 * - Không thu quá số còn phải thu (tính cả giao dịch đang chờ).
 * - Tiền mặt: nhập tiền khách đưa để tính tiền thối.
 * - Thẻ / chuyển khoản có thể tạo ở trạng thái chờ (`confirm: false`), xác nhận sau.
 * Thu đủ và mọi món đã phục vụ -> order tự hoàn tất.
 */
export const createPayment = async (
    orderId: number,
    body: ICreatePaymentBody,
    scope: Scope,
    actorId: number | undefined,
): Promise<IPayment | number> => {
    try {
        const result = await withTransaction(async () => {
            const order = await loadOrder(orderId, scope);
            const summary = await paymentRepository.getSummary(orderId);
            const due = roundVnd(Number(order.total) - summary.paid - summary.pending);
            if (due <= 0) return rollback(PAYMENT_ERROR.NOTHING_DUE);
            const amount = roundVnd(body.amount);
            if (amount > due) return rollback(PAYMENT_ERROR.AMOUNT_EXCEEDS_DUE);

            const confirm = body.confirm !== false;
            const isCash = body.method === PaymentMethodEnum.CASH;
            if (!confirm && isCash) return rollback(PAYMENT_ERROR.PENDING_CASH);

            // Tip: ghi riêng, mặc định cho nhân viên phụ trách order (câu hỏi 5)
            const tip = roundVnd(body.tip_amount ?? 0);
            let tipStaffId: number | null = null;
            if (tip > 0) {
                tipStaffId = body.tip_staff_id ?? order.assigned_staff_id ?? null;
                if (tipStaffId) {
                    const staff = await orderRepository.getStaffById(tipStaffId);
                    if (!staff || (staff.restaurant_id !== null && staff.restaurant_id !== order.restaurant_id)) {
                        return rollback(PAYMENT_ERROR.TIP_STAFF_NOT_FOUND);
                    }
                }
            }

            // Tiền mặt: khách đưa phải đủ cả tiền thanh toán và tip
            let received: number | null = null;
            let change: number | null = null;
            if (isCash && body.received_amount !== null && body.received_amount !== undefined) {
                received = roundVnd(body.received_amount);
                if (received < amount + tip) return rollback(PAYMENT_ERROR.RECEIVED_TOO_LOW);
                change = received - amount - tip;
            }

            const status = confirm ? P.PAID : P.PENDING;
            const created = await paymentRepository.createPayment({
                order_id: orderId,
                restaurant_id: order.restaurant_id,
                type: PaymentTypeEnum.PAYMENT,
                method: body.method,
                amount,
                status,
                received_amount: received,
                change_amount: change,
                reference: body.reference ?? null,
                note: body.note ?? null,
                cashier_id: actorId ?? null,
                paid_at: confirm ? new Date() : null,
                tip_amount: tip,
                tip_staff_id: tipStaffId,
            });
            const closed = confirm ? await orderService.completeIfSettled(order) : null;
            return { order, id: created.id, status, closed };
        });
        if (typeof result === "number") return result;
        emitPaymentChanged(result.order, result.id, result.status, result.closed);
        return (await paymentRepository.getPaymentById(result.id))!;
    } catch (error) {
        return PAYMENT_ERROR.FAILED;
    }
};

/** Đổi trạng thái giao dịch đang chờ: xác nhận đã nhận tiền / hủy / thất bại */
const settlePending = async (
    id: number,
    status: PaymentStatusEnum.PAID | PaymentStatusEnum.CANCELLED | PaymentStatusEnum.FAILED,
    scope: Scope,
    actorId: number | undefined,
): Promise<IPayment | number> => {
    try {
        const result = await withTransaction(async () => {
            const { payment, order } = await loadPayment(id, scope);
            if (payment.type !== PaymentTypeEnum.PAYMENT || !WAITING.includes(payment.status)) {
                return rollback(PAYMENT_ERROR.INVALID_STATUS);
            }
            await paymentRepository.updatePayment(id, {
                status,
                paid_at: status === P.PAID ? new Date() : null,
                cashier_id: actorId ?? payment.cashier_id,
            });
            const closed = status === P.PAID ? await orderService.completeIfSettled(order) : null;
            return { order, closed };
        });
        if (typeof result === "number") return result;
        emitPaymentChanged(result.order, id, status, result.closed);
        return (await paymentRepository.getPaymentById(id))!;
    } catch (error) {
        return PAYMENT_ERROR.FAILED;
    }
};

export const confirmPayment = (id: number, scope: Scope, actorId?: number) => settlePending(id, P.PAID, scope, actorId);
export const cancelPayment = (id: number, scope: Scope, actorId?: number) => settlePending(id, P.CANCELLED, scope, actorId);
export const failPayment = (id: number, scope: Scope, actorId?: number) => settlePending(id, P.FAILED, scope, actorId);

/**
 * Hoàn tiền (cần `payment.refund`): tạo dòng `refund` cùng phương thức với payment gốc, có lý do.
 * Hoàn hết thì payment gốc chuyển `refunded`. Ghi audit log trong cùng transaction.
 * Không mở lại order; order đang mở thì số còn phải thu tăng tương ứng.
 */
export const refundPayment = async (
    id: number,
    body: IRefundBody,
    scope: Scope,
    audit: IAuditContext,
): Promise<IPayment | number> => {
    try {
        const result = await withTransaction(async () => {
            const { payment, order } = await loadPayment(id, scope);
            if (payment.type !== PaymentTypeEnum.PAYMENT || ![P.PAID, P.REFUNDED].includes(payment.status)) {
                return rollback(PAYMENT_ERROR.INVALID_STATUS);
            }
            const refundable = roundVnd(Number(payment.amount) - Number(payment.refunded_amount ?? 0));
            const amount = roundVnd(body.amount);
            if (refundable <= 0 || amount > refundable) return rollback(PAYMENT_ERROR.REFUND_EXCEEDS);

            const refund = await paymentRepository.createPayment({
                order_id: payment.order_id,
                restaurant_id: payment.restaurant_id,
                type: PaymentTypeEnum.REFUND,
                method: payment.method,
                amount,
                status: P.PAID,
                note: body.reason,
                refund_of_payment_id: payment.id,
                cashier_id: audit.userId ?? null,
                paid_at: new Date(),
            });
            const fully = amount === refundable;
            if (fully) await paymentRepository.updatePayment(payment.id, { status: P.REFUNDED });
            // Giai đoạn 13: order đã hoàn tất thì trừ lại điểm thưởng tương ứng số tiền hoàn
            if (order.status === OrderStatusEnum.COMPLETED) await loyaltyService.onRefund(order.id, amount);

            await writeAudit(audit, {
                action: "payment.refund",
                entity_type: "payment",
                entity_id: payment.id,
                restaurant_id: payment.restaurant_id,
                before: { status: payment.status, amount: payment.amount, refunded_amount: payment.refunded_amount },
                after: {
                    refund_id: refund.id,
                    amount,
                    reason: body.reason,
                    status: fully ? P.REFUNDED : payment.status,
                    order_id: order.id,
                    order_code: order.code,
                },
            });
            return { order, refundId: refund.id };
        });
        if (typeof result === "number") return result;
        emitPaymentChanged(result.order, result.refundId, P.PAID, null);
        return (await paymentRepository.getPaymentById(result.refundId))!;
    } catch (error) {
        return PAYMENT_ERROR.FAILED;
    }
};
