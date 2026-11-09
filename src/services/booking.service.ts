import bcrypt from "bcrypt";
import { randomInt } from "crypto";
import { ReservationStatusEnum } from "~/common/enum";
import { BOOKING_ERROR, PUBLIC_ERROR } from "~/common/error-code/customer";
import { RESERVATION_ERROR } from "~/common/error-code/reservation";
import { pool, rollback, withTransaction } from "~/config/db";
import { IBookingSlot, IOnlineBookingBody, IPublicMenu, IPublicReservation, IPublicRestaurant } from "~/interfaces";
import { customerRepository, reservationRepository } from "~/repositories";
import { DAY_MS, todayVn, vnDateTime } from "~/utils/hr-time";
import { notifyOnlineBooking, sendBookingOtp } from "./booking-mail";
import * as reservationService from "./reservation.service";

/**
 * Giai đoạn 13: thông tin công khai và đặt bàn online (câu hỏi 7 đã chốt).
 * - Khách vãng lai nhập email nhận OTP (10 phút, tối đa 5 lần nhập sai, tối đa 3 mã / 15 phút / email);
 *   khách đã đăng nhập (tài khoản khách) bỏ qua OTP và đơn gắn vào tài khoản.
 * - Đơn online ở trạng thái `pending`, hệ thống tự chọn bàn bằng gợi ý bàn đang có (giữ chỗ, chống trùng lịch); lễ tân xác nhận.
 * - Khách tra cứu / hủy bằng mã đặt bàn + số điện thoại.
 */

const OTP_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_PER_WINDOW = 3;
const OTP_WINDOW_MINUTES = 15;
const SLOT_MINUTES = 30;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const digits = (phone: string) => phone.replace(/\D/g, "");

type BookingRestaurant = IPublicRestaurant;

// ---------------------------------------------------------------------------
// Thông tin công khai
// ---------------------------------------------------------------------------

export const getRestaurants = async (): Promise<IPublicRestaurant[] | number> => {
    try {
        return await customerRepository.getPublicRestaurants();
    } catch (error) {
        return PUBLIC_ERROR.FAILED;
    }
};

export const getMenu = async (restaurantId: number): Promise<IPublicMenu | number> => {
    try {
        const restaurant = await customerRepository.getPublicRestaurant(restaurantId);
        if (!restaurant) return PUBLIC_ERROR.RESTAURANT_NOT_FOUND;
        const [images, menu] = await Promise.all([customerRepository.getRestaurantImages(restaurantId), customerRepository.getPublicMenu(restaurantId)]);
        const { qr_ordering_enabled, ...info } = restaurant;
        return { restaurant: info, images, ...menu };
    } catch (error) {
        return PUBLIC_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// Giờ trống
// ---------------------------------------------------------------------------

/** Khung giờ mở cửa của ngày `date`: [open, close); đóng <= mở nghĩa là đóng cửa ngày hôm sau */
const openingWindow = (r: BookingRestaurant, date: string) => {
    const open = vnDateTime(date, r.open_time);
    let close = vnDateTime(date, r.close_time);
    if (close <= open) close = new Date(close.getTime() + DAY_MS);
    return { open, close };
};

/** Lỗi nếu giờ đến không hợp lệ với quy định đặt online của chi nhánh */
const checkTime = async (r: BookingRestaurant, date: string, start: Date): Promise<number | undefined> => {
    const now = Date.now();
    const end = new Date(start.getTime() + r.online_booking_minutes * 60_000);
    const { open, close } = openingWindow(r, date);
    if (start < open || end > close) return BOOKING_ERROR.INVALID_TIME;
    if (start.getTime() < now + r.online_booking_lead_minutes * 60_000) return BOOKING_ERROR.INVALID_TIME;
    if (start.getTime() > now + r.online_booking_max_days * DAY_MS) return BOOKING_ERROR.INVALID_TIME;
    if (await customerRepository.isClosedDay(r.id, date)) return BOOKING_ERROR.INVALID_TIME;
    return undefined;
};

/** Bàn gợi ý (một bàn đủ chỗ, hoặc ghép trong một phòng) còn trống cho khoảng giờ */
const suggestFor = async (restaurantId: number, start: Date, end: Date, guestCount: number): Promise<number[]> => {
    const tables = await reservationRepository.getAvailableTables(restaurantId, start, end);
    return reservationService.suggestTables(tables, guestCount);
};

const loadBookable = async (restaurantId: number): Promise<BookingRestaurant | number> => {
    const r = await customerRepository.getPublicRestaurant(restaurantId);
    if (!r) return BOOKING_ERROR.RESTAURANT_NOT_FOUND;
    if (!r.online_booking_enabled) return BOOKING_ERROR.DISABLED;
    return r;
};

/** Các khung giờ (mỗi 30 phút) trong ngày, kèm còn bàn hay không */
export const getSlots = async (restaurantId: number, date: string, guestCount: number): Promise<IBookingSlot[] | number> => {
    try {
        const r = await loadBookable(restaurantId);
        if (typeof r === "number") return r;
        if (guestCount > r.online_booking_max_guests) return BOOKING_ERROR.TOO_MANY_GUESTS;
        if (date < todayVn() || (await customerRepository.isClosedDay(r.id, date))) return [];
        const { open, close } = openingWindow(r, date);
        const slots: IBookingSlot[] = [];
        for (let t = open.getTime(); t + r.online_booking_minutes * 60_000 <= close.getTime(); t += SLOT_MINUTES * 60_000) {
            const start = new Date(t);
            const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" }).format(start);
            if ((await checkTime(r, date, start)) !== undefined) continue;
            const end = new Date(t + r.online_booking_minutes * 60_000);
            slots.push({ time, available: (await suggestFor(r.id, start, end, guestCount)).length > 0 });
        }
        return slots;
    } catch (error) {
        return BOOKING_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// OTP
// ---------------------------------------------------------------------------

export const sendOtp = async (email: string, ip: string | null): Promise<{ email: string; expires_in_minutes: number } | number> => {
    try {
        if ((await customerRepository.countRecentVerifications(email, OTP_WINDOW_MINUTES)) >= OTP_PER_WINDOW) return BOOKING_ERROR.TOO_MANY_OTP;
        const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
        await customerRepository.createVerification(email, bcrypt.hashSync(code, 8), new Date(Date.now() + OTP_MINUTES * 60_000), ip);
        try {
            await sendBookingOtp(email, code);
        } catch (error) {
            return BOOKING_ERROR.MAIL_FAILED;
        }
        return { email, expires_in_minutes: OTP_MINUTES };
    } catch (error) {
        return BOOKING_ERROR.FAILED;
    }
};

/**
 * Kiểm tra OTP (ngoài transaction tạo đơn, để lần nhập sai luôn được đếm).
 * Trả về id mã đúng, hoặc mã lỗi.
 */
const checkOtp = async (email: string, code: string): Promise<number | { id: number }> => {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const row = (
            await client.query(
                `SELECT id, hash_code, attempts FROM booking_verifications
                WHERE lower(email) = lower($1) AND used_at IS NULL AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
                [email],
            )
        ).rows[0];
        if (!row || row.attempts >= OTP_MAX_ATTEMPTS) {
            await client.query("COMMIT");
            return BOOKING_ERROR.OTP_INVALID;
        }
        if (!bcrypt.compareSync(code, row.hash_code)) {
            await client.query("UPDATE booking_verifications SET attempts = attempts + 1 WHERE id = $1", [row.id]);
            await client.query("COMMIT");
            return BOOKING_ERROR.OTP_INVALID;
        }
        await client.query("COMMIT");
        return { id: row.id };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

// ---------------------------------------------------------------------------
// Đặt bàn
// ---------------------------------------------------------------------------

const newLookupCode = () => Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]).join("");

const fromReservationError = (code: number) => {
    if (code === RESERVATION_ERROR.TABLE_CONFLICT || code === RESERVATION_ERROR.INSUFFICIENT_CAPACITY || code === RESERVATION_ERROR.INVALID_TABLES) {
        return BOOKING_ERROR.NO_TABLE;
    }
    if (code === RESERVATION_ERROR.START_IN_PAST) return BOOKING_ERROR.INVALID_TIME;
    return BOOKING_ERROR.FAILED;
};

type WithPrivate = IPublicReservation & { id: number; contact_email: string | null; source: string; guest_user_id: number | null };
const toPublic = ({ id, contact_email, source, guest_user_id, ...rest }: WithPrivate): IPublicReservation => rest;

/**
 * Tạo đơn đặt online. `guest`: khách đã đăng nhập (bỏ qua OTP, thông tin liên hệ mặc định lấy từ hồ sơ).
 */
export const createOnlineBooking = async (
    body: IOnlineBookingBody,
    guest: { id: number; full_name: string; phone_number: string | null; email: string | null } | null,
): Promise<IPublicReservation | number> => {
    try {
        const r = await loadBookable(body.restaurant_id);
        if (typeof r === "number") return r;
        if (body.guest_count > r.online_booking_max_guests) return BOOKING_ERROR.TOO_MANY_GUESTS;
        const name = body.contact_name || guest?.full_name;
        const phone = body.contact_phone || guest?.phone_number;
        const email = body.contact_email || guest?.email || null;
        if (!name || !phone || (!guest && !email)) return BOOKING_ERROR.CONTACT_REQUIRED;

        const start = vnDateTime(body.date, body.time);
        const end = new Date(start.getTime() + r.online_booking_minutes * 60_000);
        const timeError = await checkTime(r, body.date, start);
        if (timeError !== undefined) return timeError;

        let otpId: number | null = null;
        if (!guest) {
            if (!body.otp_code) return BOOKING_ERROR.OTP_INVALID;
            const otp = await checkOtp(email!, body.otp_code);
            if (typeof otp === "number") return otp;
            otpId = otp.id;
        }

        const result = await withTransaction(async () => {
            if (otpId) {
                // Khóa lại: mã chưa bị dùng bởi một yêu cầu song song
                const fresh = await customerRepository.getActiveVerification(email!);
                if (!fresh || fresh.id !== otpId) return rollback(BOOKING_ERROR.OTP_INVALID);
                await customerRepository.useVerification(otpId);
            }
            const tableIds = await suggestFor(r.id, start, end, body.guest_count);
            if (!tableIds.length) return rollback(BOOKING_ERROR.NO_TABLE);
            const created = await reservationService.createReservation(
                {
                    restaurant_id: r.id,
                    table_ids: tableIds,
                    guest_count: body.guest_count,
                    start_time: start,
                    end_time: end,
                    guest_user_id: guest?.id ?? null,
                    contact_name: name,
                    contact_phone: phone,
                    note: body.note ?? null,
                    status: ReservationStatusEnum.PENDING,
                },
                r.id,
                undefined,
            );
            if (typeof created === "number") return rollback(fromReservationError(created));
            let code = newLookupCode();
            while (await customerRepository.getReservationByCode(code)) code = newLookupCode();
            await customerRepository.setReservationOnline(created.id, { lookup_code: code, contact_email: email });
            return { id: created.id };
        });
        if (typeof result === "number") return result;
        void notifyOnlineBooking(result.id);
        return toPublic((await customerRepository.getPublicReservationById(result.id))!);
    } catch (error) {
        return BOOKING_ERROR.FAILED;
    }
};

/** Tra cứu bằng mã + SĐT (so khớp phần chữ số) */
const loadByCode = async (code: string, phone: string, forUpdate = false) => {
    const r = await customerRepository.getReservationByCode(code, forUpdate);
    if (!r || digits(r.contact_phone) !== digits(phone) || !digits(phone)) return undefined;
    return r;
};

export const lookupBooking = async (code: string, phone: string): Promise<IPublicReservation | number> => {
    try {
        const r = await loadByCode(code, phone);
        return r ? toPublic(r) : BOOKING_ERROR.NOT_FOUND;
    } catch (error) {
        return BOOKING_ERROR.FAILED;
    }
};

/** Khách tự hủy: chỉ khi đơn còn chờ / đã xác nhận và chưa tới giờ đến */
export const cancelBooking = async (code: string, phone: string, reason?: string | null): Promise<IPublicReservation | number> => {
    try {
        const r = await loadByCode(code, phone);
        if (!r) return BOOKING_ERROR.NOT_FOUND;
        return await cancelReservation(r, reason);
    } catch (error) {
        return BOOKING_ERROR.FAILED;
    }
};

/** Hủy đơn của khách (dùng chung cho tra cứu bằng mã và tài khoản khách) */
export const cancelReservation = async (
    r: { id: number; restaurant_id: number; status: ReservationStatusEnum; start_time: Date },
    reason?: string | null,
): Promise<IPublicReservation | number> => {
    const cancellable: string[] = [ReservationStatusEnum.PENDING, ReservationStatusEnum.CONFIRMED];
    if (!cancellable.includes(r.status) || new Date(r.start_time).getTime() <= Date.now()) return BOOKING_ERROR.CANNOT_CANCEL;
    const updated = await reservationService.updateReservationStatus(
        r.id,
        { status: ReservationStatusEnum.CANCELLED, cancel_reason: reason?.trim() ? `Khách hủy: ${reason.trim()}` : "Khách hủy" },
        r.restaurant_id,
    );
    if (typeof updated === "number") return BOOKING_ERROR.CANNOT_CANCEL;
    return toPublic((await customerRepository.getPublicReservationById(r.id))!);
};
