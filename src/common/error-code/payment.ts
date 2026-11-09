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
    /** Giai đoạn 14: nhà hàng chưa bật / chưa khai báo tài khoản nhận chuyển khoản QR */
    QR_NOT_CONFIGURED: 11,
};

/** Giai đoạn 14: giao dịch ngân hàng báo về qua webhook */
export const GATEWAY_ERROR = {
    FAILED: 0,
    NOT_FOUND: 1,
    /** Webhook sai khóa API */
    UNAUTHORIZED: 2,
    INVALID_PAYLOAD: 3,
    /** Giao dịch đã được xử lý (đã ghi nhận / bỏ qua) */
    ALREADY_RESOLVED: 4,
    ORDER_NOT_FOUND: 5,
    ORDER_CLOSED: 6,
    /** Số tiền giao dịch lớn hơn số còn phải thu của order */
    AMOUNT_EXCEEDS_DUE: 7,
    /** Order thuộc nhà hàng khác với tài khoản nhận tiền */
    RESTAURANT_MISMATCH: 8,
};

/** Giai đoạn 14: hóa đơn điện tử */
export const EINVOICE_ERROR = {
    FAILED: 0,
    NOT_FOUND: 1,
    ORDER_NOT_FOUND: 2,
    /** Chỉ phát hành cho order đã hoàn tất */
    ORDER_NOT_COMPLETED: 3,
    /** Order đã có hóa đơn còn hiệu lực */
    ALREADY_ISSUED: 4,
    /** Nhà hàng chưa khai báo tên pháp lý / mã số thuế / ký hiệu hóa đơn */
    SELLER_NOT_CONFIGURED: 5,
    INVALID_STATUS: 6,
    /** Người mua là doanh nghiệp thì cần tên công ty và mã số thuế */
    BUYER_REQUIRED: 7,
    /** Nhà cung cấp hóa đơn từ chối (chi tiết trong error_message) */
    PROVIDER_ERROR: 8,
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
