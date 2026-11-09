import { FeedbackStatusEnum, OrderStatusEnum } from "~/common/enum";
import { FEEDBACK_ERROR } from "~/common/error-code/customer";
import { rollback, withTransaction } from "~/config/db";
import { IAuditContext, IFeedback, IFeedbackBody, IFeedbackSummary, IPagination } from "~/interfaces";
import { customerRepository } from "~/repositories";
import { IFeedbackFilter } from "~/repositories/customer.repository";
import { emitToRestaurant } from "~/sockets";
import { writeAudit } from "~/utils/audit";
import { FEEDBACK_HOURS } from "./order-request.service";

/**
 * Giai đoạn 13: phản hồi sau bữa ăn. Mỗi order một phản hồi.
 * - Khách có tài khoản: đánh giá order của mình đã hoàn tất (trong 30 ngày) từ lịch sử.
 * - Khách vãng lai: qua trang QR của bàn, cho order vừa hoàn tất ở bàn trong 24 giờ (bàn chưa có khách mới).
 * - Quản lý (`feedback.reply`) trả lời và chuyển trạng thái xử lý; có nhật ký.
 */

const ACCOUNT_FEEDBACK_DAYS = 30;

const create = async (order: { id: number; restaurant_id: number }, body: IFeedbackBody, guestUserId: number | null): Promise<IFeedback | number> => {
    const result = await withTransaction(async () => {
        if (await customerRepository.getFeedbackByOrder(order.id)) return rollback(FEEDBACK_ERROR.ALREADY_SUBMITTED);
        const { id } = await customerRepository.createFeedback({ ...body, order_id: order.id, restaurant_id: order.restaurant_id, guest_user_id: guestUserId });
        return (await customerRepository.getFeedbackById(id))!;
    });
    if (typeof result !== "number") {
        emitToRestaurant(result.restaurant_id, "feedback:created", { restaurant_id: result.restaurant_id, feedback_id: result.id, is_complaint: result.is_complaint });
    }
    return result;
};

/** Qua trang QR của bàn: chỉ order đang được mời đánh giá ở bàn đó */
export const submitAtTable = async (token: string, orderId: number, body: IFeedbackBody, guestUserId: number | null): Promise<IFeedback | number> => {
    try {
        const table = await customerRepository.getTableByToken(token);
        if (!table) return FEEDBACK_ERROR.ORDER_NOT_ELIGIBLE;
        const recent = await customerRepository.getRecentCompletedOrderAtTable(table.id, FEEDBACK_HOURS);
        if (!recent || recent.id !== orderId) {
            return (await customerRepository.getFeedbackByOrder(orderId)) ? FEEDBACK_ERROR.ALREADY_SUBMITTED : FEEDBACK_ERROR.ORDER_NOT_ELIGIBLE;
        }
        return await create({ id: orderId, restaurant_id: table.restaurant_id }, body, guestUserId);
    } catch (error) {
        return FEEDBACK_ERROR.FAILED;
    }
};

/** Khách có tài khoản đánh giá order của mình */
export const submitForAccount = async (userId: number, orderId: number, body: IFeedbackBody): Promise<IFeedback | number> => {
    try {
        const order = await customerRepository.getOrderForFeedback(orderId);
        const fresh = order?.completed_at && Date.now() - new Date(order.completed_at).getTime() < ACCOUNT_FEEDBACK_DAYS * 86_400_000;
        if (!order || order.guest_user_id !== userId || order.status !== OrderStatusEnum.COMPLETED || !fresh) return FEEDBACK_ERROR.ORDER_NOT_ELIGIBLE;
        return await create(order, body, userId);
    } catch (error) {
        return FEEDBACK_ERROR.FAILED;
    }
};

export const getFeedbacks = async (
    filter: IFeedbackFilter,
    page: { limit: number; currentPage: number },
): Promise<{ feedbacks: IFeedback[]; summary: IFeedbackSummary; pagination: IPagination } | number> => {
    try {
        const [{ rows, total }, summary] = await Promise.all([
            customerRepository.getFeedbacks(filter, page.limit, (page.currentPage - 1) * page.limit),
            customerRepository.getFeedbackSummary(filter),
        ]);
        return {
            feedbacks: rows,
            summary,
            pagination: { limit: page.limit, currentPage: page.currentPage, totalItems: total, totalPages: Math.max(1, Math.ceil(total / page.limit)) },
        };
    } catch (error) {
        return FEEDBACK_ERROR.FAILED;
    }
};

export const replyFeedback = async (
    id: number,
    body: { reply?: string | null; status?: FeedbackStatusEnum },
    scope: number | null | undefined,
    audit: IAuditContext,
): Promise<IFeedback | number> => {
    try {
        return await withTransaction(async () => {
            const before = await customerRepository.getFeedbackById(id);
            if (!before || (scope !== null && scope !== undefined && before.restaurant_id !== scope)) return rollback(FEEDBACK_ERROR.NOT_FOUND);
            // Trả lời mà không chọn trạng thái: coi như đã xử lý
            const status = body.status ?? (body.reply ? FeedbackStatusEnum.RESOLVED : undefined);
            await customerRepository.updateFeedback(id, { status, reply: body.reply, replied_by: audit.userId ?? null });
            const after = (await customerRepository.getFeedbackById(id))!;
            await writeAudit(audit, {
                action: "feedback.reply",
                entity_type: "feedback",
                entity_id: id,
                restaurant_id: before.restaurant_id,
                before: { status: before.status, reply: before.reply },
                after: { status: after.status, reply: after.reply },
            });
            return after;
        });
    } catch (error) {
        return FEEDBACK_ERROR.FAILED;
    }
};
