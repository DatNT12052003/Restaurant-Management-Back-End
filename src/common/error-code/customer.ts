/** Giai đoạn 13: mã lỗi của kênh khách hàng */

export const PUBLIC_ERROR = {
    FAILED: 0,
    RESTAURANT_NOT_FOUND: 1,
    TABLE_NOT_FOUND: 2,
};

export const BOOKING_ERROR = {
    FAILED: 0,
    RESTAURANT_NOT_FOUND: 1,
    /** Chi nhánh tắt đặt bàn online */
    DISABLED: 2,
    /** Ngoài giờ mở cửa, ngày nghỉ, quá sớm / quá xa */
    INVALID_TIME: 3,
    TOO_MANY_GUESTS: 4,
    /** Không còn bàn phù hợp */
    NO_TABLE: 5,
    /** Mã OTP sai, hết hạn hoặc đã dùng */
    OTP_INVALID: 6,
    /** Thiếu tên / SĐT / email */
    CONTACT_REQUIRED: 7,
    /** Gửi mail thất bại */
    MAIL_FAILED: 8,
    NOT_FOUND: 9,
    /** Đơn không còn hủy được (đã đến, đã qua giờ) */
    CANNOT_CANCEL: 10,
    /** Gửi OTP quá nhiều lần */
    TOO_MANY_OTP: 11,
};

export const ORDER_REQUEST_ERROR = {
    FAILED: 0,
    TABLE_NOT_FOUND: 1,
    /** Chi nhánh tắt gọi món QR */
    DISABLED: 2,
    /** Món không có hoặc ngừng bán */
    ITEM_UNAVAILABLE: 3,
    /** Bàn đã có quá nhiều yêu cầu đang chờ */
    TOO_MANY_PENDING: 4,
    NOT_FOUND: 5,
    INVALID_STATUS: 6,
    /** Bàn đang không dùng được (bảo trì / dọn) mà chưa có order */
    TABLE_UNAVAILABLE: 7,
    EMPTY: 8,
};

export const LOYALTY_ERROR = {
    FAILED: 0,
    GUEST_NOT_FOUND: 1,
    DISABLED: 2,
    /** Order chưa gắn khách */
    NO_GUEST: 3,
    INSUFFICIENT_POINTS: 4,
    ORDER_NOT_FOUND: 5,
    /** Order đã có thanh toán: không đổi điểm nữa */
    HAS_PAYMENTS: 6,
    /** Điều chỉnh làm số dư âm */
    NEGATIVE_BALANCE: 7,
};

export const FEEDBACK_ERROR = {
    FAILED: 0,
    /** Order không tồn tại, không phải của khách, chưa hoàn tất hoặc quá hạn đánh giá */
    ORDER_NOT_ELIGIBLE: 1,
    ALREADY_SUBMITTED: 2,
    NOT_FOUND: 3,
};
