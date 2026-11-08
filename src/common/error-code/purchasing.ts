export const SUPPLIER_ERROR = {
    FAILED: 0,
    NOT_FOUND: 1,
    DUPLICATE_NAME: 2,
    /** Còn đơn đặt hàng chưa xong hoặc công nợ chưa trả */
    IN_USE: 3,
    INVALID_INGREDIENTS: 4,
};

export const PURCHASE_ERROR = {
    FAILED: 0,
    NOT_FOUND: 1,
    RESTAURANT_REQUIRED: 2,
    RESTAURANT_NOT_FOUND: 3,
    /** Nhà cung cấp không tồn tại hoặc đã ngừng giao dịch */
    SUPPLIER_INVALID: 4,
    /** Có nguyên liệu không tồn tại / đã ngừng dùng */
    INVALID_INGREDIENTS: 5,
    /** Trạng thái đơn không cho phép thao tác này */
    INVALID_STATUS: 6,
    /** Dòng nhận hàng không thuộc đơn */
    INVALID_LINES: 7,
    /** Nguyên liệu theo dõi hạn dùng phải có hạn dùng khi nhận */
    EXPIRY_REQUIRED: 8,
    /** Đơn đã nhận hàng: không hủy được (hãy đóng đơn) */
    HAS_RECEIPTS: 9,
};

export const TRANSFER_ERROR = {
    FAILED: 0,
    NOT_FOUND: 1,
    RESTAURANT_REQUIRED: 2,
    /** Chi nhánh nhận không tồn tại hoặc trùng chi nhánh gửi */
    INVALID_DESTINATION: 3,
    INVALID_INGREDIENTS: 4,
    /** Chuyển nhiều hơn tồn kho của chi nhánh gửi */
    INSUFFICIENT_STOCK: 5,
    INVALID_STATUS: 6,
    /** Chỉ chi nhánh nhận được xác nhận nhận hàng / chỉ chi nhánh gửi được hủy */
    WRONG_BRANCH: 7,
    /** Số thực nhận vượt số đã gửi, hoặc dòng không thuộc phiếu */
    INVALID_LINES: 8,
};

export const PAYABLE_ERROR = {
    FAILED: 0,
    NOT_FOUND: 1,
    /** Khoản đã trả hết */
    ALREADY_PAID: 2,
    /** Số tiền trả vượt số còn nợ */
    AMOUNT_EXCEEDS: 3,
};
