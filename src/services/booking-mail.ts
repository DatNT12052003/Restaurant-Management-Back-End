import logger from "~/config/logger";
import { ReservationStatusEnum } from "~/common/enum";
import { customerRepository } from "~/repositories";
import { sendMail } from "./mail.service";

/**
 * Giai đoạn 13: email cho đơn đặt bàn online (gửi sau khi commit, lỗi chỉ ghi log).
 * Tách riêng để reservation.service và booking.service cùng dùng mà không import vòng.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const fmt = (d: Date) =>
    new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "full", timeStyle: "short" }).format(new Date(d));

/** Đường dẫn tra cứu đơn trên trang khách (CORS_ORIGINS đầu tiên, hoặc Vite dev) */
const lookupUrl = (code: string) => {
    const origin = (process.env.PUBLIC_WEB_URL || process.env.CORS_ORIGINS?.split(",")[0] || "http://localhost:5173").trim().replace(/\/$/, "");
    return `${origin}/booking/${encodeURIComponent(code)}`;
};

const SUBJECT: Partial<Record<ReservationStatusEnum, string>> = {
    [ReservationStatusEnum.PENDING]: "Đã nhận yêu cầu đặt bàn",
    [ReservationStatusEnum.CONFIRMED]: "Đặt bàn đã được xác nhận",
    [ReservationStatusEnum.CANCELLED]: "Đặt bàn đã bị hủy",
};

export const sendBookingOtp = (email: string, code: string) =>
    sendMail({
        to: email,
        subject: `Mã xác nhận đặt bàn: ${code}`,
        html: `<p>Mã xác nhận đặt bàn của bạn là <strong style="font-size:20px;letter-spacing:4px">${code}</strong>.</p><p>Mã có hiệu lực trong 10 phút. Nếu bạn không đặt bàn, hãy bỏ qua email này.</p>`,
    });

/** Gửi email theo trạng thái hiện tại của đơn online (chờ xác nhận / đã xác nhận / đã hủy) */
export const notifyOnlineBooking = async (reservationId: number): Promise<void> => {
    try {
        const r = await customerRepository.getPublicReservationById(reservationId);
        if (!r || r.source !== "online" || !r.contact_email || !r.lookup_code) return;
        const subject = SUBJECT[r.status];
        if (!subject) return;
        const lines = [
            `<p>Xin chào ${esc(r.contact_name)},</p>`,
            `<p><strong>${subject}</strong> tại <strong>${esc(r.restaurant_name)}</strong> (${esc(r.restaurant_address ?? "")}).</p>`,
            `<ul><li>Mã đặt bàn: <strong>${r.lookup_code}</strong></li><li>Thời gian: ${fmt(r.start_time)}</li><li>Số khách: ${r.guest_count}</li></ul>`,
            r.status === ReservationStatusEnum.PENDING ? "<p>Nhà hàng sẽ xác nhận sớm. Bạn sẽ nhận thêm email khi đơn được xác nhận.</p>" : "",
            r.status === ReservationStatusEnum.CANCELLED && r.cancel_reason ? `<p>Lý do: ${esc(r.cancel_reason)}</p>` : "",
            `<p>Xem hoặc hủy đặt bàn: <a href="${lookupUrl(r.lookup_code)}">${lookupUrl(r.lookup_code)}</a> (cần số điện thoại đã đặt).</p>`,
            r.restaurant_phone ? `<p>Liên hệ nhà hàng: ${esc(r.restaurant_phone)}</p>` : "",
        ];
        await sendMail({ to: r.contact_email, subject: `${subject} - ${r.lookup_code}`, html: lines.join("") });
    } catch (error) {
        logger.error("Send booking email failed", { error: (error as Error).message, reservationId });
    }
};
