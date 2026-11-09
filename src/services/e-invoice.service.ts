import { OrderStatusEnum } from "~/common/enum";
import { EINVOICE_MAX_ATTEMPTS } from "~/common/constant";
import { EINVOICE_ERROR } from "~/common/error-code/payment";
import { db, rollback, withTransaction } from "~/config/db";
import logger from "~/config/logger";
import {
    IAuditContext,
    IEInvoice,
    IEInvoiceBuyer,
    IEInvoiceLine,
    IEInvoiceSeller,
    IGetEInvoices,
    IOrder,
    IRestaurant,
    ISelectQuery,
} from "~/interfaces";
import { eInvoiceRepository, orderRepository, paymentRepository, restaurantRepository } from "~/repositories";
import { emitToRestaurant } from "~/sockets";
import { writeAudit } from "~/utils/audit";
import { roundVnd } from "~/utils/billing";
import { buildPagination } from "~/utils/pagination";
import { eInvoiceProviderName, getEInvoiceProvider } from "./einvoice-providers";
import { inScope } from "./room.service";

/**
 * Giai đoạn 14: hóa đơn điện tử (câu hỏi 12).
 * - Phát hành theo yêu cầu (thu ngân nhập người mua) cho order đã hoàn tất, hoặc tự phát hành khi order hoàn tất nếu
 *   nhà hàng bật `einvoice_auto_issue` (người mua lấy từ khách gắn với order, không có thì là khách lẻ).
 * - Dòng hóa đơn, người bán, tiền được chụp lại lúc tạo. Gửi nhà cung cấp ngoài transaction; lỗi thì thử lại theo lịch
 *   (job mỗi phút), tối đa `EINVOICE_MAX_ATTEMPTS` lần, sau đó cần thử lại tay.
 */

type Scope = number | null | undefined;

/** Lịch thử lại (phút) theo số lần đã gửi */
const RETRY_MINUTES = [1, 5, 15, 60, 240, 720];

const sellerOf = (r: IRestaurant): IEInvoiceSeller | null =>
    r.tax_code && r.einvoice_series
        ? { name: r.legal_name || r.name, tax_code: r.tax_code, address: r.address, phone: r.phone ?? null }
        : null;

/** Dòng hóa đơn và tiền, từ order đã hoàn tất */
const snapshotOf = async (order: IOrder) => {
    const items = await paymentRepository.getInvoiceLines(order.id);
    const lines: IEInvoiceLine[] = items.map((l) => ({
        kind: "item",
        name: l.name,
        unit: l.kind === "combo" ? "Suất" : "Phần",
        quantity: Number(l.quantity),
        unit_price: Number(l.unit_price),
        amount: Number(l.amount),
    }));
    const discount = roundVnd(Number(order.discount_amount ?? 0));
    if (discount > 0) {
        lines.push({ kind: "discount", name: "Chiết khấu thương mại", unit: "", quantity: 1, unit_price: -discount, amount: -discount });
    }
    const fee = roundVnd(Number(order.service_fee ?? 0));
    if (fee > 0) lines.push({ kind: "service_fee", name: "Phí dịch vụ", unit: "Lần", quantity: 1, unit_price: fee, amount: fee });
    const total = roundVnd(Number(order.total));
    const tax = roundVnd(Number(order.tax ?? 0));
    return { lines, amount_before_tax: total - tax, tax_rate: Number(order.tax_rate ?? 0), tax_amount: tax, total };
};

const getGuestContact = async (userId: number | null) => {
    if (!userId) return null;
    const result = await db().query("SELECT full_name, email, phone_number FROM users WHERE id = $1", [userId]);
    return result.rows[0] as { full_name: string; email: string | null; phone_number: string | null } | undefined;
};

/** Tạo dòng hóa đơn chờ gửi. Gọi trong transaction, order đã khóa và đã hoàn tất. */
const createPending = async (
    order: IOrder,
    restaurant: IRestaurant,
    seller: IEInvoiceSeller,
    buyer: IEInvoiceBuyer,
    source: "auto" | "manual",
    createdBy: number | null,
) => {
    const snap = await snapshotOf(order);
    return eInvoiceRepository.createEInvoice({
        order_id: order.id,
        restaurant_id: order.restaurant_id,
        provider: eInvoiceProviderName(),
        status: "pending",
        source,
        buyer_type: buyer.buyer_type,
        buyer_name: buyer.buyer_name ?? null,
        buyer_company: buyer.buyer_type === "company" ? (buyer.buyer_company ?? null) : null,
        buyer_tax_code: buyer.buyer_type === "company" ? (buyer.buyer_tax_code ?? null) : null,
        buyer_address: buyer.buyer_address ?? null,
        buyer_email: buyer.buyer_email ?? null,
        buyer_phone: buyer.buyer_phone ?? null,
        seller,
        series: restaurant.einvoice_series,
        created_by: createdBy,
        ...snap,
    });
};

/**
 * Gọi từ `closeOrder` khi order hoàn tất (trong transaction): nhà hàng bật tự phát hành thì tạo hóa đơn chờ gửi,
 * job gửi trong vòng một phút. Không bao giờ làm hỏng việc hoàn tất order.
 */
export const queueAutoInvoice = async (orderId: number): Promise<void> => {
    const order = await orderRepository.getOrderRow(orderId);
    if (!order) return;
    const restaurant = await restaurantRepository.getRestaurantById(order.restaurant_id);
    if (!restaurant?.einvoice_auto_issue) return;
    const seller = sellerOf(restaurant);
    if (!seller || Number(order.total) <= 0) return;
    if (await eInvoiceRepository.getActiveByOrder(orderId)) return;
    const guest = await getGuestContact(order.guest_user_id);
    await createPending(
        order,
        restaurant,
        seller,
        {
            buyer_type: "individual",
            buyer_name: guest?.full_name ?? null,
            buyer_email: guest?.email ?? null,
            buyer_phone: guest?.phone_number ?? null,
        },
        "auto",
        null,
    );
};

const emitChanged = (invoice: { id: number; restaurant_id: number; order_id: number; status: string }) =>
    emitToRestaurant(invoice.restaurant_id, "einvoice:changed", {
        restaurant_id: invoice.restaurant_id,
        e_invoice_id: invoice.id,
        order_id: invoice.order_id,
        status: invoice.status,
    });

/** Gửi một hóa đơn cho nhà cung cấp (ngoài transaction). Trả về hóa đơn sau khi gửi, hoặc undefined nếu không nhận được. */
export const dispatch = async (id: number): Promise<IEInvoice | undefined> => {
    const invoice = await eInvoiceRepository.claimForDispatch(id);
    if (!invoice) return undefined;
    try {
        const issued = await getEInvoiceProvider().issue(invoice);
        await eInvoiceRepository.updateEInvoice(id, {
            status: "issued",
            series: issued.series,
            invoice_no: issued.invoice_no,
            lookup_code: issued.lookup_code,
            lookup_url: issued.lookup_url,
            provider_ref: issued.provider_ref,
            issued_at: issued.issued_at,
            next_retry_at: null,
            error_message: null,
        });
    } catch (error) {
        const message = (error as Error).message || "provider error";
        const retryIn = invoice.attempts < EINVOICE_MAX_ATTEMPTS ? RETRY_MINUTES[Math.min(invoice.attempts, RETRY_MINUTES.length) - 1] : null;
        logger.warn("E-invoice dispatch failed", { e_invoice_id: id, attempts: invoice.attempts, error: message });
        await eInvoiceRepository.updateEInvoice(id, {
            status: "failed",
            error_message: message.slice(0, 2000),
            next_retry_at: retryIn ? new Date(Date.now() + retryIn * 60_000) : null,
        });
    }
    const fresh = (await eInvoiceRepository.getEInvoiceById(id))!;
    emitChanged(fresh);
    return fresh;
};

/** Job mỗi phút: gửi hóa đơn chờ và thử lại hóa đơn lỗi đến hạn */
export const dispatchDue = async () => {
    const ids = await eInvoiceRepository.getDueIds(EINVOICE_MAX_ATTEMPTS);
    let issued = 0;
    let failed = 0;
    for (const id of ids) {
        const result = await dispatch(id);
        if (result?.status === "issued") issued++;
        else if (result?.status === "failed") failed++;
    }
    return { issued, failed };
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const getEInvoices = async (params: ISelectQuery): Promise<IGetEInvoices | number> => {
    try {
        const result = await eInvoiceRepository.getEInvoices(params);
        return { e_invoices: result.rows, pagination: buildPagination(params, result.totalCount) };
    } catch (error) {
        return EINVOICE_ERROR.FAILED;
    }
};

export const getEInvoice = async (id: number, scope: Scope): Promise<IEInvoice | number> => {
    try {
        const invoice = await eInvoiceRepository.getEInvoiceById(id);
        if (!invoice || !inScope(invoice.restaurant_id, scope)) return EINVOICE_ERROR.NOT_FOUND;
        return invoice;
    } catch (error) {
        return EINVOICE_ERROR.FAILED;
    }
};

/** Phát hành theo yêu cầu cho order đã hoàn tất (`einvoice.issue`) */
export const issueForOrder = async (
    orderId: number,
    buyer: IEInvoiceBuyer,
    scope: Scope,
    audit: IAuditContext,
): Promise<IEInvoice | number> => {
    try {
        const result = await withTransaction(async () => {
            const order = await orderRepository.getOrderRow(orderId, true);
            if (!order || !inScope(order.restaurant_id, scope)) return rollback(EINVOICE_ERROR.ORDER_NOT_FOUND);
            if (order.status !== OrderStatusEnum.COMPLETED) return rollback(EINVOICE_ERROR.ORDER_NOT_COMPLETED);
            if (buyer.buyer_type === "company" && (!buyer.buyer_company || !buyer.buyer_tax_code)) {
                return rollback(EINVOICE_ERROR.BUYER_REQUIRED);
            }
            const restaurant = (await restaurantRepository.getRestaurantById(order.restaurant_id))!;
            const seller = sellerOf(restaurant);
            if (!seller) return rollback(EINVOICE_ERROR.SELLER_NOT_CONFIGURED);
            if (await eInvoiceRepository.getActiveByOrder(orderId)) return rollback(EINVOICE_ERROR.ALREADY_ISSUED);
            const created = await createPending(order, restaurant, seller, buyer, "manual", audit.userId ?? null);
            await writeAudit(audit, {
                action: "einvoice.issue",
                entity_type: "e_invoice",
                entity_id: created.id,
                restaurant_id: order.restaurant_id,
                after: {
                    order_id: order.id,
                    order_code: order.code,
                    buyer_type: buyer.buyer_type,
                    buyer_tax_code: buyer.buyer_tax_code ?? null,
                    total: order.total,
                },
            });
            return { id: created.id };
        });
        if (typeof result === "number") return result;
        return (await dispatch(result.id)) ?? (await eInvoiceRepository.getEInvoiceById(result.id))!;
    } catch (error) {
        logger.error("issueForOrder failed", { error: (error as Error).message });
        return EINVOICE_ERROR.FAILED;
    }
};

/** Gửi lại hóa đơn lỗi / đang chờ ngay (`einvoice.issue`) */
export const retryEInvoice = async (id: number, scope: Scope): Promise<IEInvoice | number> => {
    try {
        const invoice = await eInvoiceRepository.getEInvoiceById(id);
        if (!invoice || !inScope(invoice.restaurant_id, scope)) return EINVOICE_ERROR.NOT_FOUND;
        if (invoice.status !== "failed" && invoice.status !== "pending") return EINVOICE_ERROR.INVALID_STATUS;
        // Thử lại tay: đặt lại lịch (và số lần, để job tự thử tiếp nếu vẫn lỗi)
        await eInvoiceRepository.updateEInvoice(id, { next_retry_at: null, attempts: 0 });
        return (await dispatch(id)) ?? (await eInvoiceRepository.getEInvoiceById(id))!;
    } catch (error) {
        return EINVOICE_ERROR.FAILED;
    }
};

/** Hủy hóa đơn (`einvoice.cancel`): đã cấp số thì gọi nhà cung cấp hủy; sau đó có thể phát hành lại */
export const cancelEInvoice = async (
    id: number,
    reason: string,
    scope: Scope,
    audit: IAuditContext,
): Promise<IEInvoice | number> => {
    try {
        const invoice = await eInvoiceRepository.getEInvoiceById(id);
        if (!invoice || !inScope(invoice.restaurant_id, scope)) return EINVOICE_ERROR.NOT_FOUND;
        if (invoice.status === "cancelled") return EINVOICE_ERROR.INVALID_STATUS;
        if (invoice.status === "issued") {
            try {
                await getEInvoiceProvider().cancel(invoice, reason);
            } catch (error) {
                await eInvoiceRepository.updateEInvoice(id, { error_message: (error as Error).message.slice(0, 2000) });
                return EINVOICE_ERROR.PROVIDER_ERROR;
            }
        }
        const result = await withTransaction(async () => {
            const locked = (await eInvoiceRepository.getEInvoiceById(id, true))!;
            if (locked.status === "cancelled") return rollback(EINVOICE_ERROR.INVALID_STATUS);
            await eInvoiceRepository.updateEInvoice(id, {
                status: "cancelled",
                cancelled_at: new Date(),
                cancelled_by: audit.userId ?? null,
                cancel_reason: reason,
                next_retry_at: null,
            });
            await writeAudit(audit, {
                action: "einvoice.cancel",
                entity_type: "e_invoice",
                entity_id: id,
                restaurant_id: locked.restaurant_id,
                before: { status: locked.status, series: locked.series, invoice_no: locked.invoice_no },
                after: { status: "cancelled", reason },
            });
            return true;
        });
        if (typeof result === "number") return result;
        const fresh = (await eInvoiceRepository.getEInvoiceById(id))!;
        emitChanged(fresh);
        return fresh;
    } catch (error) {
        return EINVOICE_ERROR.FAILED;
    }
};

/** Hóa đơn còn hiệu lực của order (cho màn hình thu ngân / phiếu in) */
export const getActiveForOrder = (orderId: number) => eInvoiceRepository.getActiveByOrder(orderId);
