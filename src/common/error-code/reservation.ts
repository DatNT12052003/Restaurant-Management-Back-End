export const RESERVATION_ERROR = {
    FAILED: 0,
    NOT_FOUND: 1,
    RESTAURANT_REQUIRED: 2,
    RESTAURANT_NOT_FOUND: 3,
    /** Bàn không tồn tại, thuộc nhà hàng khác hoặc nằm trong phòng đang tạm khóa */
    INVALID_TABLES: 4,
    /** Bàn đã có lịch đặt khác chồng thời gian */
    TABLE_CONFLICT: 5,
    INSUFFICIENT_CAPACITY: 6,
    GUEST_NOT_FOUND: 7,
    CONTACT_REQUIRED: 8,
    /** Chỉ sửa được khi đang chờ xác nhận / đã xác nhận */
    NOT_EDITABLE: 9,
    INVALID_TRANSITION: 10,
    START_IN_PAST: 11,
    NO_SHOW_TOO_EARLY: 12,
    /** Khách đến nhưng bàn đang có khách khác */
    TABLES_OCCUPIED: 13,
    /** Không xóa reservation khi khách đang ngồi */
    CANNOT_DELETE: 14,
    /** Giờ kết thúc không sau giờ bắt đầu (khi chỉ sửa một đầu) */
    INVALID_TIME: 15,
    /** Hoàn tất reservation khi order vẫn đang mở */
    ORDER_OPEN: 16,
};
