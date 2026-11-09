export enum OTPTypeEnum {
    RESET_PASSWORD = "reset_password",
    VERIFY_EMAIL = "verify_email",
    LOGIN = "login",
    CHANGE_EMAIL = "change_email",
    TWO_FA = "two_fa",
}

export enum TokenTypeEnum {
    ACCESS = "access",
    REFRESH = "refresh",
    RESET_PASSWORD = "reset_password",
}

export enum FilterOperatorEnum {
    EQUAL = "=",
    NOT_EQUAL = "!=",
    GREATER_THAN = ">",
    LESS_THAN = "<",
    ILIKE = "ilike",
    IN = "in",
    IS = "is",
}

export enum OrderTypeEnum {
    ASC = "asc",
    DESC = "desc",
}

export enum JoinTypeEnum {
    INNER = "inner",
    LEFT = "left",
    RIGHT = "right",
}

export enum GenderEnum {
    MALE = "male",
    FEMALE = "female",
    OTHER = "other",
}

export enum UserStatusEnum {
    ACTIVE = "active",
    INACTIVE = "inactive",
}

export enum RestaurantStatusEnum {
    BLOCKED = "blocked",
    UNBLOCKED = "unblocked",
}

export enum GuestStatusEnum {
    NEW = "new",
    REGULAR = "regular",
}

export enum RolesEnum {
    ADMIN = "admin",
    MANAGER = "manager",
    SUPERVISOR = "supervisor",
    CASHIER = "cashier",
    RECEPTIONIST = "receptionist",
    WAITSTAFF = "waitstaff",
    BARISTA = "barista",
    HEAD_CHEF = "head_chef",
    SOUS_CHEF = "sous_chef",
    COMMIS_CHEF = "commis_chef",
    CLEANER_STAFF = "clean_staff",
    GUARD = "guard",
    GUEST = "guest",
}

export enum RoomTypeEnum {
    PUBLIC = "public",
    PRIVATE = "private",
    PRIVATE_PRO = "private_pro",
}

/** Trạng thái sử dụng của phòng/bàn. Trạng thái khóa/mở được tách riêng thành cột `is_active`. */
export enum UsageStatusEnum {
    AVAILABLE = "available",
    RESERVED = "reserved",
    OCCUPIED = "occupied",
    CLEANING = "cleaning",
}

export enum DishCategoryEnum {
    /** Chuyển cho bếp */
    FOOD = "food",
    /** Chuyển cho quầy pha chế */
    DRINK = "drink",
}

/** Trạng thái kinh doanh của món / combo */
export enum MenuItemStatusEnum {
    ACTIVE = "active",
    DISCONTINUED = "discontinued",
}

/** Đối tượng có thể gắn ảnh (bảng images) */
export enum ImageEntityEnum {
    RESTAURANT = "restaurant",
    ROOM = "room",
    DISH = "dish",
    COMBO = "combo",
}

/** Trạng thái đặt bàn (đặc tả 8.4) */
export enum ReservationStatusEnum {
    PENDING = "pending",
    CONFIRMED = "confirmed",
    ARRIVED = "arrived",
    COMPLETED = "completed",
    CANCELLED = "cancelled",
    NO_SHOW = "no_show",
}

/** Trạng thái order (đặc tả 4.7) */
export enum OrderStatusEnum {
    /** Dành cho order khách tự tạo, chờ nhân viên xác nhận (chưa dùng) */
    PENDING = "pending",
    /** Đã mở, chưa gửi món nào */
    CONFIRMED = "confirmed",
    /** Đã gửi ít nhất một đợt gọi món */
    SERVING = "serving",
    COMPLETED = "completed",
    CANCELLED = "cancelled",
    /** Đã gộp vào order khác (`merged_into_order_id`); mọi món và bàn đã chuyển sang order đó */
    MERGED = "merged",
}

/** Trạng thái món / combo trong order (đặc tả 4.7) */
export enum OrderItemStatusEnum {
    PENDING = "pending",
    CONFIRMED = "confirmed",
    COOKING = "cooking",
    READY = "ready",
    SERVED = "served",
    CANCELLED = "cancelled",
}

/** Nơi chế biến món */
export enum KitchenStationEnum {
    KITCHEN = "kitchen",
    BAR = "bar",
}

export enum DiscountTypeEnum {
    /** Giảm theo % tạm tính (có thể giới hạn bằng max_discount) */
    PERCENT = "percent",
    /** Giảm số tiền cố định */
    FIXED = "fixed",
}

export enum DiscountStatusEnum {
    ACTIVE = "active",
    INACTIVE = "inactive",
}

export enum PaymentMethodEnum {
    CASH = "cash",
    CARD = "card",
    TRANSFER = "transfer",
}

/** Trạng thái giao dịch (đặc tả 4.8) */
export enum PaymentStatusEnum {
    PENDING = "pending",
    PROCESSING = "processing",
    PAID = "paid",
    FAILED = "failed",
    CANCELLED = "cancelled",
    /** Payment gốc đã được hoàn hết */
    REFUNDED = "refunded",
}

export enum PaymentTypeEnum {
    PAYMENT = "payment",
    REFUND = "refund",
}

export enum IngredientStatusEnum {
    ACTIVE = "active",
    /** Ngừng dùng: không nhập thêm được, vẫn xuất / kiểm kê được phần còn lại */
    INACTIVE = "inactive",
}

/** Loại phiếu kho */
export enum InventoryReceiptTypeEnum {
    IMPORT = "import",
    EXPORT = "export",
    /** Kiểm kê: nhập số thực tế, hệ thống ghi chênh lệch */
    ADJUST = "adjust",
    /** Hủy hàng hết hạn / hỏng (giai đoạn 11) */
    DISPOSE = "dispose",
}

/** Loại biến động kho (consume: tự trừ theo định lượng món — chưa dùng) */
export enum InventoryTransactionTypeEnum {
    IMPORT = "import",
    EXPORT = "export",
    ADJUST = "adjust",
    CONSUME = "consume",
    DISPOSE = "dispose",
    TRANSFER_OUT = "transfer_out",
    TRANSFER_IN = "transfer_in",
}

/** Giai đoạn 11: mua hàng, chuyển kho, công nợ */
export enum SupplierStatusEnum {
    ACTIVE = "active",
    INACTIVE = "inactive",
}

export enum PurchaseOrderStatusEnum {
    DRAFT = "draft",
    SENT = "sent",
    /** Đã nhận một phần */
    PARTIAL = "partial",
    /** Đã nhận đủ mọi dòng */
    RECEIVED = "received",
    /** Đóng đơn khi còn thiếu (không chờ nhận thêm) */
    CLOSED = "closed",
    CANCELLED = "cancelled",
}

export enum StockTransferStatusEnum {
    IN_TRANSIT = "in_transit",
    RECEIVED = "received",
    CANCELLED = "cancelled",
}

export enum SupplierBillStatusEnum {
    UNPAID = "unpaid",
    PARTIAL = "partial",
    PAID = "paid",
}

/** Giai đoạn 12: nhân sự */
export enum PayTypeEnum {
    /** Lương tháng, chia theo ngày công chuẩn */
    MONTHLY = "monthly",
    /** Đơn giá theo giờ */
    HOURLY = "hourly",
}

export enum ShiftSwapStatusEnum {
    /** Chờ người nhận đồng ý */
    PENDING_TARGET = "pending_target",
    /** Người nhận đã đồng ý, chờ quản lý duyệt */
    PENDING_APPROVAL = "pending_approval",
    APPROVED = "approved",
    /** Quản lý từ chối */
    REJECTED = "rejected",
    /** Người nhận từ chối */
    DECLINED = "declined",
    CANCELLED = "cancelled",
}

export enum OvertimeStatusEnum {
    NONE = "none",
    PENDING = "pending",
    APPROVED = "approved",
    REJECTED = "rejected",
}

export enum LeaveTypeEnum {
    PAID = "paid",
    UNPAID = "unpaid",
}

export enum LeaveStatusEnum {
    PENDING = "pending",
    APPROVED = "approved",
    REJECTED = "rejected",
    CANCELLED = "cancelled",
}

export enum AdjustmentTypeEnum {
    BONUS = "bonus",
    PENALTY = "penalty",
}

export enum PayrollStatusEnum {
    DRAFT = "draft",
    FINALIZED = "finalized",
}

/** Giai đoạn 13: kênh khách hàng */
export enum ReservationSourceEnum {
    STAFF = "staff",
    ONLINE = "online",
}

export enum OrderRequestStatusEnum {
    PENDING = "pending",
    ACCEPTED = "accepted",
    REJECTED = "rejected",
}

export enum LoyaltyTransactionTypeEnum {
    EARN = "earn",
    REDEEM = "redeem",
    REVOKE = "revoke",
    ADJUST = "adjust",
}

export enum FeedbackStatusEnum {
    NEW = "new",
    IN_PROGRESS = "in_progress",
    RESOLVED = "resolved",
}
