export const ORDER_ERROR = {
    FAILED: 0,
    NOT_FOUND: 1,
    RESTAURANT_REQUIRED: 2,
    RESTAURANT_NOT_FOUND: 3,
    /** Bàn không tồn tại, thuộc nhà hàng khác hoặc nằm trong phòng đang tạm khóa */
    INVALID_TABLES: 4,
    /** Bàn đang thuộc một order khác chưa đóng */
    TABLE_BUSY: 5,
    /** Order đã hoàn tất / đã hủy */
    ORDER_CLOSED: 6,
    /** Bàn không thuộc order này */
    TABLE_NOT_IN_ORDER: 7,
    /** Không gỡ được bàn cuối cùng của order */
    LAST_TABLE: 8,
    /** Món / combo đã ngừng bán hoặc chi nhánh đang tắt */
    ITEM_UNAVAILABLE: 9,
    ITEM_NOT_FOUND: 10,
    INVALID_TRANSITION: 11,
    /** Có quyền thao tác order nhưng không có quyền cho bước chuyển trạng thái này */
    TRANSITION_FORBIDDEN: 12,
    /** Còn món chưa phục vụ xong */
    ITEMS_NOT_SERVED: 13,
    /** Đã phục vụ món nên không hủy được order */
    HAS_SERVED_ITEMS: 14,
    RESERVATION_NOT_FOUND: 15,
    /** Reservation đã hủy / hoàn tất / không đến */
    RESERVATION_CLOSED: 16,
    /** Reservation đã có order */
    RESERVATION_HAS_ORDER: 17,
    GUEST_NOT_FOUND: 18,
    STAFF_NOT_FOUND: 19,
};
