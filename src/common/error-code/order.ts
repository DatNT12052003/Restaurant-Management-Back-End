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
    /** Chưa thu đủ tiền */
    NOT_FULLY_PAID: 20,
    /** Còn giao dịch chờ xác nhận */
    PENDING_PAYMENTS: 21,
    /** Đã thu tiền: phải hoàn tiền trước khi hủy order */
    HAS_PAYMENTS: 22,
    /** Gộp / tách: order nguồn và đích trùng nhau */
    SAME_ORDER: 23,
    /** Gộp / tách: order nguồn đã thu tiền hoặc có giao dịch chờ */
    SOURCE_HAS_PAYMENTS: 24,
    /** Order đích không tồn tại hoặc thuộc nhà hàng khác */
    TARGET_NOT_FOUND: 25,
    /** Tách: dòng món không thuộc order nguồn, đã hủy, hoặc số lượng vượt quá */
    INVALID_SPLIT_LINES: 26,
    /** Đổi trạng thái hàng loạt: không có dòng nào chuyển được */
    NO_LINES_TO_UPDATE: 27,
};
