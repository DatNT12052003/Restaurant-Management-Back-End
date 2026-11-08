export const PAYMENT_ERROR = {
    FAILED: 0,
    NOT_FOUND: 1,
    ORDER_NOT_FOUND: 2,
    /** Order đã hoàn tất / đã hủy */
    ORDER_CLOSED: 3,
    /** Order không còn tiền phải thu */
    NOTHING_DUE: 4,
    /** Số tiền vượt quá số còn phải thu */
    AMOUNT_EXCEEDS_DUE: 5,
    /** Tiền khách đưa ít hơn số tiền thanh toán */
    RECEIVED_TOO_LOW: 6,
    /** Chỉ thẻ / chuyển khoản mới tạo được giao dịch chờ xác nhận */
    PENDING_CASH: 7,
    INVALID_STATUS: 8,
    /** Hoàn quá số tiền còn hoàn được */
    REFUND_EXCEEDS: 9,
    /** Nhân viên nhận tip không thuộc nhà hàng */
    TIP_STAFF_NOT_FOUND: 10,
};

export const DISCOUNT_ERROR = {
    FAILED: 0,
    NOT_FOUND: 1,
    DUPLICATE_CODE: 2,
    /** Không được sửa / xóa mã của nhà hàng khác hoặc mã dùng chung cả chuỗi */
    FORBIDDEN: 3,
    RESTAURANT_NOT_FOUND: 4,
    INACTIVE: 5,
    NOT_STARTED: 6,
    EXPIRED: 7,
    /** Mã thuộc nhà hàng khác */
    NOT_APPLICABLE: 8,
    MIN_ORDER_NOT_MET: 9,
    USAGE_LIMIT_REACHED: 10,
    PER_USER_LIMIT_REACHED: 11,
    /** Mã giới hạn theo khách nhưng order chưa gắn khách */
    GUEST_REQUIRED: 12,
    ORDER_NOT_FOUND: 13,
    ORDER_CLOSED: 14,
    /** Order chưa áp mã nào */
    NO_DISCOUNT: 15,
    /** Sau khi gộp với dữ liệu cũ: % > 100 hoặc ngày kết thúc trước ngày bắt đầu */
    INVALID_VALUE: 16,
};
