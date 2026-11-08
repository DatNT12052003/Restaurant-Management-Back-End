import { PG_ERROR } from "~/common/constant";
import { DiscountStatusEnum, DiscountTypeEnum } from "~/common/enum";
import { DISCOUNT_ERROR } from "~/common/error-code/payment";
import { rollback, withTransaction } from "~/config/db";
import { IDiscount, IDiscountBody, IGetDiscounts, IOrder, ISelectQuery } from "~/interfaces";
import { discountRepository, orderRepository, restaurantRepository } from "~/repositories";
import { OPEN_ORDER_STATUSES } from "~/repositories/order.repository";
import { emitToRestaurant } from "~/sockets";
import { getPgErrorCode } from "~/utils/common";
import { buildPagination } from "~/utils/pagination";
import { inScope } from "./room.service";

/** `scope`: null = mọi nhà hàng (admin); số = chỉ nhà hàng này. */
type Scope = number | null | undefined;

const toDiscountError = (error: unknown): number =>
    getPgErrorCode(error) === PG_ERROR.UNIQUE_VIOLATION ? DISCOUNT_ERROR.DUPLICATE_CODE : DISCOUNT_ERROR.FAILED;

/** Người bị giới hạn nhà hàng thấy mã của cả chuỗi và mã của nhà hàng mình */
const visible = (discount: IDiscount, scope: Scope) =>
    scope === null || scope === undefined || discount.restaurant_id === null || discount.restaurant_id === scope;

/**
 * Lấy mã để sửa / xóa: người bị giới hạn chỉ sửa mã của nhà hàng mình (mã cả chuỗi chỉ admin sửa).
 * Gọi trong transaction.
 */
const loadEditable = async (id: number, scope: Scope): Promise<IDiscount> => {
    const discount = await discountRepository.getDiscountById(id, true);
    if (!discount || !visible(discount, scope)) return rollback(DISCOUNT_ERROR.NOT_FOUND);
    if (scope !== null && scope !== undefined && discount.restaurant_id !== scope) return rollback(DISCOUNT_ERROR.FORBIDDEN);
    return discount;
};

const checkRestaurant = async (restaurantId: number | null | undefined) => {
    if (restaurantId && !(await restaurantRepository.getRestaurantById(restaurantId))) {
        return rollback(DISCOUNT_ERROR.RESTAURANT_NOT_FOUND);
    }
};

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export const getDiscounts = async (params: ISelectQuery, scope: Scope): Promise<IGetDiscounts | number> => {
    try {
        const conditions =
            scope === null || scope === undefined
                ? []
                : [`(dc.restaurant_id IS NULL OR dc.restaurant_id = ${Number(scope)})`];
        const result = await discountRepository.getDiscounts({ ...params, conditions });
        return { discounts: result.rows, pagination: buildPagination(params, result.totalCount) };
    } catch (error) {
        return DISCOUNT_ERROR.FAILED;
    }
};

export const getDiscountById = async (id: number, scope: Scope): Promise<IDiscount | number> => {
    try {
        const discount = await discountRepository.getDiscountById(id);
        if (!discount || !visible(discount, scope)) return DISCOUNT_ERROR.NOT_FOUND;
        return discount;
    } catch (error) {
        return DISCOUNT_ERROR.FAILED;
    }
};

export const createDiscount = async (
    body: IDiscountBody,
    scope: Scope,
    actorId: number | undefined,
): Promise<IDiscount | number> => {
    try {
        return await withTransaction(async () => {
            const restaurantId = scope ?? body.restaurant_id ?? null;
            await checkRestaurant(restaurantId);
            const created = await discountRepository.createDiscount({
                ...body,
                restaurant_id: restaurantId,
                created_by: actorId ?? null,
            });
            return (await discountRepository.getDiscountById(created.id))!;
        });
    } catch (error) {
        return toDiscountError(error);
    }
};

/** Các trường ảnh hưởng tới số tiền được giảm */
const AMOUNT_FIELDS: (keyof IDiscountBody)[] = ["type", "value", "min_order_value", "max_discount"];

/**
 * Tính lại tiền của các order đang mở đã áp mã (sau khi sửa giá trị mã).
 * Mỗi order một transaction riêng, chạy SAU khi lưu mã: khóa order rồi tính lại, cùng thứ tự khóa với lúc áp mã
 * (order -> mã) nên không deadlock. Order đã đóng trong lúc chờ thì bỏ qua.
 */
export const recomputeOpenOrders = async (discountId: number): Promise<number[]> => {
    const updated: number[] = [];
    for (const orderId of await orderRepository.getOpenOrderIdsByDiscount(discountId)) {
        const order = await withTransaction(async () => {
            const row = await orderRepository.getOrderRow(orderId, true);
            if (!row || !OPEN_ORDER_STATUSES.includes(row.status)) return null;
            await orderRepository.recomputeTotals(orderId);
            return row;
        });
        if (order && typeof order !== "number") {
            emitOrder(order);
            updated.push(orderId);
        }
    }
    return updated;
};

export const updateDiscount = async (id: number, body: IDiscountBody, scope: Scope): Promise<IDiscount | number> => {
    try {
        const result = await updateDiscountRow(id, body, scope);
        if (typeof result !== "number" && AMOUNT_FIELDS.some((f) => body[f] !== undefined)) {
            await recomputeOpenOrders(id);
        }
        return result;
    } catch (error) {
        return toDiscountError(error);
    }
};

const updateDiscountRow = async (id: number, body: IDiscountBody, scope: Scope): Promise<IDiscount | number> => {
    try {
        return await withTransaction(async () => {
            const current = await loadEditable(id, scope);
            // Người bị giới hạn không được chuyển mã sang nhà hàng khác / cả chuỗi
            const payload: IDiscountBody = { ...body };
            if (scope !== null && scope !== undefined) delete payload.restaurant_id;
            else await checkRestaurant(payload.restaurant_id);

            // Kiểm tra lại sau khi gộp với dữ liệu cũ (schema chỉ thấy phần được gửi lên)
            const type = payload.type ?? current.type;
            const value = payload.value ?? Number(current.value);
            const start = payload.start_at ?? new Date(current.start_at);
            const end = payload.end_at !== undefined ? payload.end_at : current.end_at ? new Date(current.end_at) : null;
            if ((type === DiscountTypeEnum.PERCENT && value > 100) || (end && end.getTime() <= start.getTime())) {
                return rollback(DISCOUNT_ERROR.INVALID_VALUE);
            }

            await discountRepository.updateDiscount(id, payload);
            return (await discountRepository.getDiscountById(id))!;
        });
    } catch (error) {
        return toDiscountError(error);
    }
};

/** Xóa mềm; các order đã dùng mã vẫn giữ nguyên số tiền đã giảm */
export const deleteDiscount = async (id: number, scope: Scope): Promise<{ id: number } | number> => {
    try {
        return await withTransaction(async () => {
            await loadEditable(id, scope);
            return (await discountRepository.deleteDiscount(id)) ?? rollback(DISCOUNT_ERROR.NOT_FOUND);
        });
    } catch (error) {
        return DISCOUNT_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// Áp mã cho order (mỗi order tối đa một mã — câu hỏi 4)
// ---------------------------------------------------------------------------

const loadOpenOrder = async (orderId: number, scope: Scope): Promise<IOrder> => {
    const order = await orderRepository.getOrderRow(orderId, true);
    if (!order || !inScope(order.restaurant_id, scope)) return rollback(DISCOUNT_ERROR.ORDER_NOT_FOUND);
    if (!OPEN_ORDER_STATUSES.includes(order.status)) return rollback(DISCOUNT_ERROR.ORDER_CLOSED);
    return order;
};

const emitOrder = (order: IOrder) =>
    emitToRestaurant(order.restaurant_id, "order:updated", {
        restaurant_id: order.restaurant_id,
        order_id: order.id,
        code: order.code,
        status: order.status,
    });

/**
 * Kiểm tra điều kiện của mã với order (gọi trong transaction, mã đã được khóa FOR UPDATE):
 * trạng thái, thời gian, nhà hàng, giá trị tối thiểu, tổng lượt dùng, lượt dùng mỗi khách.
 */
const checkApplicable = async (discount: IDiscount, order: IOrder, alreadyOnOrder: boolean) => {
    const now = Date.now();
    if (discount.status !== DiscountStatusEnum.ACTIVE) return rollback(DISCOUNT_ERROR.INACTIVE);
    if (new Date(discount.start_at).getTime() > now) return rollback(DISCOUNT_ERROR.NOT_STARTED);
    if (discount.end_at && new Date(discount.end_at).getTime() <= now) return rollback(DISCOUNT_ERROR.EXPIRED);
    if (discount.restaurant_id !== null && discount.restaurant_id !== order.restaurant_id) {
        return rollback(DISCOUNT_ERROR.NOT_APPLICABLE);
    }
    if (Number(order.subtotal) < Number(discount.min_order_value)) return rollback(DISCOUNT_ERROR.MIN_ORDER_NOT_MET);
    if (!alreadyOnOrder && discount.usage_limit !== null && discount.used_count >= discount.usage_limit) {
        return rollback(DISCOUNT_ERROR.USAGE_LIMIT_REACHED);
    }
    if (discount.per_user_limit !== null) {
        if (!order.guest_user_id) return rollback(DISCOUNT_ERROR.GUEST_REQUIRED);
        const used = await discountRepository.countGuestUsage(discount.id, order.guest_user_id, order.id);
        if (used >= discount.per_user_limit) return rollback(DISCOUNT_ERROR.PER_USER_LIMIT_REACHED);
    }
};

/** Áp mã cho order; nếu order đang có mã khác thì thay (trả lại lượt dùng của mã cũ). */
export const applyDiscount = async (
    orderId: number,
    code: string,
    scope: Scope,
    actorId: number | undefined,
): Promise<{ order_id: number } | number> => {
    try {
        const result = await withTransaction(async () => {
            const order = await loadOpenOrder(orderId, scope);
            const discount = await discountRepository.getDiscountByCodeForUpdate(code);
            if (!discount) return rollback(DISCOUNT_ERROR.NOT_FOUND);

            const current = await discountRepository.getOrderDiscount(orderId);
            const same = current?.discount_id === discount.id;
            await checkApplicable(discount, order, same);

            if (!same) {
                if (current) await discountRepository.changeUsage(current.discount_id, -1);
                await discountRepository.setOrderDiscount(orderId, discount.id, actorId ?? null);
                await discountRepository.changeUsage(discount.id, 1);
            }
            await orderRepository.recomputeTotals(orderId);
            return order;
        });
        if (typeof result === "number") return result;
        emitOrder(result);
        return { order_id: orderId };
    } catch (error) {
        return DISCOUNT_ERROR.FAILED;
    }
};

export const removeDiscount = async (orderId: number, scope: Scope): Promise<{ order_id: number } | number> => {
    try {
        const result = await withTransaction(async () => {
            const order = await loadOpenOrder(orderId, scope);
            const removed = await discountRepository.removeOrderDiscount(orderId);
            if (!removed) return rollback(DISCOUNT_ERROR.NO_DISCOUNT);
            await discountRepository.changeUsage(removed.discount_id, -1);
            await orderRepository.recomputeTotals(orderId);
            return order;
        });
        if (typeof result === "number") return result;
        emitOrder(result);
        return { order_id: orderId };
    } catch (error) {
        return DISCOUNT_ERROR.FAILED;
    }
};
