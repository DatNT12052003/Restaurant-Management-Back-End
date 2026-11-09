import { GuestStatusEnum, LoyaltyTransactionTypeEnum } from "~/common/enum";
import { LOYALTY_ERROR } from "~/common/error-code/customer";
import { rollback, withTransaction } from "~/config/db";
import { IAuditContext, ILoyaltyGuest, ILoyaltySettings, ILoyaltyTransaction } from "~/interfaces";
import { customerRepository, orderRepository, paymentRepository } from "~/repositories";
import { OPEN_ORDER_STATUSES } from "~/repositories/order.repository";
import { emitToRestaurant } from "~/sockets";
import { diffChanges, writeAudit } from "~/utils/audit";

/**
 * Giai đoạn 13: điểm thưởng (chung cả chuỗi).
 * - Order gắn tài khoản khách, khi hoàn tất: cộng floor(thực trả / earn_amount) điểm (tip không tính vì nằm ngoài `amount`).
 * - Thu ngân đổi điểm trên order đang mở, chưa có thanh toán: giảm `points × point_value`, tối đa `max_redeem_percent`%
 *   phần còn lại sau mã giảm giá. Điểm chỉ bị trừ khỏi số dư khi order hoàn tất; trong lúc chờ được tính là "đang giữ".
 * - Hoàn tiền order đã hoàn tất: trừ lại điểm tương ứng (không vượt số đã cộng, không làm số dư âm).
 * - Đủ `regular_visit_count` order hoàn tất trong `regular_window_months` tháng thì thành khách thân thiết (không tự hạ).
 */

const T = LoyaltyTransactionTypeEnum;

export const getSettings = async (): Promise<ILoyaltySettings | number> => {
    try {
        return await customerRepository.getLoyaltySettings();
    } catch (error) {
        return LOYALTY_ERROR.FAILED;
    }
};

export const updateSettings = async (body: Partial<ILoyaltySettings>, audit: IAuditContext): Promise<ILoyaltySettings | number> => {
    try {
        return await withTransaction(async () => {
            const before = await customerRepository.getLoyaltySettings();
            const after = await customerRepository.updateLoyaltySettings(body, audit.userId ?? null);
            const { updated_at: _b, ...b } = before;
            const { updated_at: _a, ...a } = after;
            await writeAudit(audit, { action: "loyalty.settings_update", entity_type: "loyalty_settings", entity_id: 1, restaurant_id: null, ...diffChanges(b, a) });
            return after;
        });
    } catch (error) {
        return LOYALTY_ERROR.FAILED;
    }
};

export const searchGuests = async (q: string): Promise<ILoyaltyGuest[] | number> => {
    try {
        return await customerRepository.searchGuests(q.trim());
    } catch (error) {
        return LOYALTY_ERROR.FAILED;
    }
};

export const getGuest = async (userId: number): Promise<(ILoyaltyGuest & { transactions: ILoyaltyTransaction[] }) | number> => {
    try {
        const guest = await customerRepository.getLoyaltyGuest(userId);
        if (!guest) return LOYALTY_ERROR.GUEST_NOT_FOUND;
        return { ...guest, transactions: await customerRepository.getLoyaltyTransactions(userId) };
    } catch (error) {
        return LOYALTY_ERROR.FAILED;
    }
};

/** Điều chỉnh điểm tay (cộng hoặc trừ), bắt buộc ghi chú, có nhật ký */
export const adjustPoints = async (userId: number, points: number, note: string, audit: IAuditContext): Promise<ILoyaltyGuest | number> => {
    try {
        return await withTransaction(async () => {
            const guest = await customerRepository.getLoyaltyGuest(userId, 0, true);
            if (!guest) return rollback(LOYALTY_ERROR.GUEST_NOT_FOUND);
            if (guest.loyalty_points + points < 0) return rollback(LOYALTY_ERROR.NEGATIVE_BALANCE);
            const balance = await customerRepository.addLoyaltyTransaction({ user_id: userId, type: T.ADJUST, points, note, created_by: audit.userId ?? null });
            await writeAudit(audit, {
                action: "loyalty.adjust",
                entity_type: "user",
                entity_id: userId,
                restaurant_id: null,
                before: { loyalty_points: guest.loyalty_points },
                after: { loyalty_points: balance, points, note },
            });
            return (await customerRepository.getLoyaltyGuest(userId))!;
        });
    } catch (error) {
        return LOYALTY_ERROR.FAILED;
    }
};

/**
 * Đổi điểm cho order đang mở (`points` = 0 để bỏ). Số điểm thực dùng có thể ít hơn nếu vượt trần % hóa đơn.
 * Trả về order sau khi tính lại tiền.
 */
export const redeemOnOrder = async (
    orderId: number,
    points: number,
    scope: number | null | undefined,
    audit: IAuditContext,
): Promise<{ order_id: number; points_redeemed: number; points_discount: number; available_points: number } | number> => {
    try {
        const result = await withTransaction(async () => {
            const order = await orderRepository.getOrderRow(orderId, true);
            if (!order || (scope !== null && scope !== undefined && order.restaurant_id !== scope) || !OPEN_ORDER_STATUSES.includes(order.status)) {
                return rollback(LOYALTY_ERROR.ORDER_NOT_FOUND);
            }
            if (!order.guest_user_id) return rollback(LOYALTY_ERROR.NO_GUEST);
            const summary = await paymentRepository.getSummary(orderId);
            if (summary.paid > 0 || summary.pending > 0) return rollback(LOYALTY_ERROR.HAS_PAYMENTS);
            const settings = await customerRepository.getLoyaltySettings();
            if (points > 0 && !settings.enabled) return rollback(LOYALTY_ERROR.DISABLED);
            const guest = await customerRepository.getLoyaltyGuest(order.guest_user_id, orderId, true);
            if (!guest) return rollback(LOYALTY_ERROR.GUEST_NOT_FOUND);
            if (points > guest.available_points) return rollback(LOYALTY_ERROR.INSUFFICIENT_POINTS);

            await orderRepository.setPointsRedeemed(orderId, points);
            await orderRepository.recomputeTotals(orderId);
            const fresh = (await orderRepository.getOrderRow(orderId))!;
            await writeAudit(audit, {
                action: "loyalty.redeem",
                entity_type: "order",
                entity_id: orderId,
                restaurant_id: order.restaurant_id,
                before: { points_redeemed: order.points_redeemed ?? 0 },
                after: { points_redeemed: fresh.points_redeemed, points_discount: fresh.points_discount, guest_user_id: order.guest_user_id },
            });
            return {
                restaurant_id: order.restaurant_id,
                code: order.code,
                status: order.status,
                data: {
                    order_id: orderId,
                    points_redeemed: Number(fresh.points_redeemed),
                    points_discount: Number(fresh.points_discount),
                    available_points: guest.available_points - Number(fresh.points_redeemed),
                },
            };
        });
        if (typeof result === "number") return result;
        emitToRestaurant(result.restaurant_id, "order:updated", { restaurant_id: result.restaurant_id, order_id: orderId, code: result.code, status: result.status });
        return result.data;
    } catch (error) {
        return LOYALTY_ERROR.FAILED;
    }
};

/**
 * Order vừa hoàn tất (gọi trong transaction đóng order): trừ điểm đã đổi, cộng điểm mới, xét khách thân thiết.
 * Không gắn khách thì không làm gì.
 */
export const onOrderCompleted = async (orderId: number): Promise<void> => {
    const order = (await orderRepository.getOrderRow(orderId));
    if (!order?.guest_user_id) return;
    const userId = order.guest_user_id;
    const settings = await customerRepository.getLoyaltySettings();
    const guest = await customerRepository.getLoyaltyGuest(userId, orderId, true);
    if (!guest) return;

    const redeemed = Math.min(Number(order.points_redeemed ?? 0), guest.loyalty_points);
    if (redeemed > 0) {
        await customerRepository.addLoyaltyTransaction({ user_id: userId, order_id: orderId, type: T.REDEEM, points: -redeemed, note: order.code });
    }
    if (settings.enabled) {
        const paid = (await paymentRepository.getSummary(orderId)).paid;
        const earned = Math.floor(paid / settings.earn_amount);
        if (earned > 0) {
            await customerRepository.addLoyaltyTransaction({ user_id: userId, order_id: orderId, type: T.EARN, points: earned, note: order.code });
            await orderRepository.setPointsAwarded(orderId, earned);
        }
    }
    if (guest.guest_status !== GuestStatusEnum.REGULAR) {
        const visits = await customerRepository.countCompletedVisits(userId, settings.regular_window_months);
        if (visits >= settings.regular_visit_count) await customerRepository.setGuestRegular(userId);
    }
};

/** Hoàn tiền cho order đã hoàn tất (trong transaction hoàn tiền): trừ lại điểm đã cộng tương ứng số tiền hoàn */
export const onRefund = async (orderId: number, amount: number): Promise<void> => {
    const order = (await orderRepository.getOrderRow(orderId));
    if (!order?.guest_user_id || !Number(order.points_awarded)) return;
    const settings = await customerRepository.getLoyaltySettings();
    const guest = await customerRepository.getLoyaltyGuest(order.guest_user_id, 0, true);
    if (!guest) return;
    const remaining = Number(order.points_awarded) - (await customerRepository.getRevokedPoints(orderId));
    const revoke = Math.min(Math.floor(amount / settings.earn_amount), remaining, guest.loyalty_points);
    if (revoke > 0) {
        await customerRepository.addLoyaltyTransaction({ user_id: order.guest_user_id, order_id: orderId, type: T.REVOKE, points: -revoke, note: order.code });
    }
};

/**
 * Gắn / gỡ khách của order đang mở (thu ngân gắn theo SĐT để tích điểm). Đổi khách thì bỏ phần đổi điểm của khách cũ.
 * Không đổi khách khi order đã có thanh toán.
 */
export const attachGuest = async (
    orderId: number,
    guestUserId: number | null,
    scope: number | null | undefined,
    audit: IAuditContext,
): Promise<{ order_id: number; guest_user_id: number | null } | number> => {
    try {
        const result = await withTransaction(async () => {
            const order = await orderRepository.getOrderRow(orderId, true);
            if (!order || (scope !== null && scope !== undefined && order.restaurant_id !== scope) || !OPEN_ORDER_STATUSES.includes(order.status)) {
                return rollback(LOYALTY_ERROR.ORDER_NOT_FOUND);
            }
            if (guestUserId && !(await customerRepository.isGuestUser(guestUserId))) return rollback(LOYALTY_ERROR.GUEST_NOT_FOUND);
            const summary = await paymentRepository.getSummary(orderId);
            if (summary.paid > 0 || summary.pending > 0) return rollback(LOYALTY_ERROR.HAS_PAYMENTS);
            await orderRepository.updateOrder(orderId, { guest_user_id: guestUserId });
            if (Number(order.points_redeemed ?? 0) > 0 && guestUserId !== order.guest_user_id) {
                await orderRepository.setPointsRedeemed(orderId, 0);
                await orderRepository.recomputeTotals(orderId);
            }
            await writeAudit(audit, {
                action: "loyalty.attach_guest",
                entity_type: "order",
                entity_id: orderId,
                restaurant_id: order.restaurant_id,
                before: { guest_user_id: order.guest_user_id },
                after: { guest_user_id: guestUserId },
            });
            return { order };
        });
        if (typeof result === "number") return result;
        const { order } = result;
        emitToRestaurant(order.restaurant_id, "order:updated", { restaurant_id: order.restaurant_id, order_id: orderId, code: order.code, status: order.status });
        return { order_id: orderId, guest_user_id: guestUserId };
    } catch (error) {
        return LOYALTY_ERROR.FAILED;
    }
};
