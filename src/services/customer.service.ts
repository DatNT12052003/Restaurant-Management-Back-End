import { BOOKING_ERROR, PUBLIC_ERROR } from "~/common/error-code/customer";
import { ICustomerOrder, ICustomerProfile, ILoyaltyTransaction, IPublicReservation } from "~/interfaces";
import { customerRepository, userRepository } from "~/repositories";
import { cancelReservation } from "./booking.service";

/** Giai đoạn 13: trang tài khoản của khách (role `guest`): hồ sơ, điểm, lịch sử đặt bàn / order, phản hồi */

export const getProfile = async (userId: number): Promise<ICustomerProfile | number> => {
    try {
        const [user, stats, loyalty, guest] = await Promise.all([
            userRepository.getUserById(userId),
            customerRepository.getCustomerStats(userId),
            customerRepository.getLoyaltySettings(),
            customerRepository.getLoyaltyGuest(userId),
        ]);
        if (!user || !guest) return PUBLIC_ERROR.FAILED;
        const recent = await customerRepository.countCompletedVisits(userId, loyalty.regular_window_months);
        return {
            id: user.id,
            full_name: user.full_name,
            email: user.email ?? null,
            phone_number: user.phone_number ?? null,
            guest_status: user.guest_status ?? null,
            loyalty_points: guest.loyalty_points,
            visits: stats.visits,
            total_spent: stats.total_spent,
            regular_progress: { visits: recent, required: loyalty.regular_visit_count, months: loyalty.regular_window_months },
            loyalty,
        };
    } catch (error) {
        return PUBLIC_ERROR.FAILED;
    }
};

export const getReservations = async (userId: number): Promise<(IPublicReservation & { id: number })[] | number> => {
    try {
        return (await customerRepository.getGuestReservations(userId)).map(({ contact_email, source, guest_user_id, ...r }) => r);
    } catch (error) {
        return PUBLIC_ERROR.FAILED;
    }
};

export const cancelMyReservation = async (userId: number, reservationId: number, reason?: string | null): Promise<IPublicReservation | number> => {
    try {
        const r = await customerRepository.getPublicReservationById(reservationId);
        if (!r || r.guest_user_id !== userId) return BOOKING_ERROR.NOT_FOUND;
        return await cancelReservation(r, reason);
    } catch (error) {
        return BOOKING_ERROR.FAILED;
    }
};

export const getOrders = async (userId: number): Promise<ICustomerOrder[] | number> => {
    try {
        const orders = await customerRepository.getCustomerOrders(userId);
        const out: ICustomerOrder[] = [];
        for (const o of orders) {
            const [lines, feedback] = await Promise.all([customerRepository.getOrderLines(o.id), customerRepository.getFeedbackByOrder(o.id)]);
            out.push({ ...o, lines: lines.map(({ name, quantity, price }) => ({ name, quantity, price })), feedback: feedback ?? null });
        }
        return out;
    } catch (error) {
        return PUBLIC_ERROR.FAILED;
    }
};

export const getPoints = async (userId: number): Promise<ILoyaltyTransaction[] | number> => {
    try {
        return await customerRepository.getLoyaltyTransactions(userId);
    } catch (error) {
        return PUBLIC_ERROR.FAILED;
    }
};
