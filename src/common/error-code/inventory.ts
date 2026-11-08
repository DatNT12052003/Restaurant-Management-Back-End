export const INVENTORY_ERROR = {
    FAILED: 0,
    RESTAURANT_REQUIRED: 1,
    RESTAURANT_NOT_FOUND: 2,
    /** Có nguyên liệu không tồn tại (hoặc đã ngừng dùng khi nhập kho) */
    INVALID_INGREDIENTS: 3,
    /** Xuất nhiều hơn tồn kho */
    INSUFFICIENT_STOCK: 4,
    /** Kiểm kê không có chênh lệch nào */
    NO_CHANGES: 5,
    RECEIPT_NOT_FOUND: 6,
};

export const INGREDIENT_ERROR = {
    FAILED: 0,
    NOT_FOUND: 1,
    DUPLICATE_NAME: 2,
    /** Còn tồn kho ở ít nhất một nhà hàng */
    IN_STOCK: 3,
    /** Đã có biến động kho: không đổi được đơn vị tính */
    UNIT_LOCKED: 4,
};
