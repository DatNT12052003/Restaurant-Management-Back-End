"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FeedbackStatusEnum = exports.LoyaltyTransactionTypeEnum = exports.OrderRequestStatusEnum = exports.ReservationSourceEnum = exports.PayrollStatusEnum = exports.AdjustmentTypeEnum = exports.LeaveStatusEnum = exports.LeaveTypeEnum = exports.OvertimeStatusEnum = exports.ShiftSwapStatusEnum = exports.PayTypeEnum = exports.SupplierBillStatusEnum = exports.StockTransferStatusEnum = exports.PurchaseOrderStatusEnum = exports.SupplierStatusEnum = exports.InventoryTransactionTypeEnum = exports.InventoryReceiptTypeEnum = exports.IngredientStatusEnum = exports.PaymentTypeEnum = exports.PaymentStatusEnum = exports.PaymentMethodEnum = exports.DiscountStatusEnum = exports.DiscountTypeEnum = exports.KitchenStationEnum = exports.OrderItemStatusEnum = exports.OrderStatusEnum = exports.ReservationStatusEnum = exports.ImageEntityEnum = exports.MenuItemStatusEnum = exports.DishCategoryEnum = exports.UsageStatusEnum = exports.RoomTypeEnum = exports.RolesEnum = exports.GuestStatusEnum = exports.RestaurantStatusEnum = exports.UserStatusEnum = exports.GenderEnum = exports.JoinTypeEnum = exports.OrderTypeEnum = exports.FilterOperatorEnum = exports.TokenTypeEnum = exports.OTPTypeEnum = void 0;
var OTPTypeEnum;
(function (OTPTypeEnum) {
    OTPTypeEnum["RESET_PASSWORD"] = "reset_password";
    OTPTypeEnum["VERIFY_EMAIL"] = "verify_email";
    OTPTypeEnum["LOGIN"] = "login";
    OTPTypeEnum["CHANGE_EMAIL"] = "change_email";
    OTPTypeEnum["TWO_FA"] = "two_fa";
})(OTPTypeEnum || (exports.OTPTypeEnum = OTPTypeEnum = {}));
var TokenTypeEnum;
(function (TokenTypeEnum) {
    TokenTypeEnum["ACCESS"] = "access";
    TokenTypeEnum["REFRESH"] = "refresh";
    TokenTypeEnum["RESET_PASSWORD"] = "reset_password";
})(TokenTypeEnum || (exports.TokenTypeEnum = TokenTypeEnum = {}));
var FilterOperatorEnum;
(function (FilterOperatorEnum) {
    FilterOperatorEnum["EQUAL"] = "=";
    FilterOperatorEnum["NOT_EQUAL"] = "!=";
    FilterOperatorEnum["GREATER_THAN"] = ">";
    FilterOperatorEnum["LESS_THAN"] = "<";
    FilterOperatorEnum["ILIKE"] = "ilike";
    FilterOperatorEnum["IN"] = "in";
    FilterOperatorEnum["IS"] = "is";
})(FilterOperatorEnum || (exports.FilterOperatorEnum = FilterOperatorEnum = {}));
var OrderTypeEnum;
(function (OrderTypeEnum) {
    OrderTypeEnum["ASC"] = "asc";
    OrderTypeEnum["DESC"] = "desc";
})(OrderTypeEnum || (exports.OrderTypeEnum = OrderTypeEnum = {}));
var JoinTypeEnum;
(function (JoinTypeEnum) {
    JoinTypeEnum["INNER"] = "inner";
    JoinTypeEnum["LEFT"] = "left";
    JoinTypeEnum["RIGHT"] = "right";
})(JoinTypeEnum || (exports.JoinTypeEnum = JoinTypeEnum = {}));
var GenderEnum;
(function (GenderEnum) {
    GenderEnum["MALE"] = "male";
    GenderEnum["FEMALE"] = "female";
    GenderEnum["OTHER"] = "other";
})(GenderEnum || (exports.GenderEnum = GenderEnum = {}));
var UserStatusEnum;
(function (UserStatusEnum) {
    UserStatusEnum["ACTIVE"] = "active";
    UserStatusEnum["INACTIVE"] = "inactive";
})(UserStatusEnum || (exports.UserStatusEnum = UserStatusEnum = {}));
var RestaurantStatusEnum;
(function (RestaurantStatusEnum) {
    RestaurantStatusEnum["BLOCKED"] = "blocked";
    RestaurantStatusEnum["UNBLOCKED"] = "unblocked";
})(RestaurantStatusEnum || (exports.RestaurantStatusEnum = RestaurantStatusEnum = {}));
var GuestStatusEnum;
(function (GuestStatusEnum) {
    GuestStatusEnum["NEW"] = "new";
    GuestStatusEnum["REGULAR"] = "regular";
})(GuestStatusEnum || (exports.GuestStatusEnum = GuestStatusEnum = {}));
var RolesEnum;
(function (RolesEnum) {
    RolesEnum["ADMIN"] = "admin";
    RolesEnum["MANAGER"] = "manager";
    RolesEnum["SUPERVISOR"] = "supervisor";
    RolesEnum["CASHIER"] = "cashier";
    RolesEnum["RECEPTIONIST"] = "receptionist";
    RolesEnum["WAITSTAFF"] = "waitstaff";
    RolesEnum["BARISTA"] = "barista";
    RolesEnum["HEAD_CHEF"] = "head_chef";
    RolesEnum["SOUS_CHEF"] = "sous_chef";
    RolesEnum["COMMIS_CHEF"] = "commis_chef";
    RolesEnum["CLEANER_STAFF"] = "clean_staff";
    RolesEnum["GUARD"] = "guard";
    RolesEnum["GUEST"] = "guest";
})(RolesEnum || (exports.RolesEnum = RolesEnum = {}));
var RoomTypeEnum;
(function (RoomTypeEnum) {
    RoomTypeEnum["PUBLIC"] = "public";
    RoomTypeEnum["PRIVATE"] = "private";
    RoomTypeEnum["PRIVATE_PRO"] = "private_pro";
})(RoomTypeEnum || (exports.RoomTypeEnum = RoomTypeEnum = {}));
/** Trạng thái sử dụng của phòng/bàn. Trạng thái khóa/mở được tách riêng thành cột `is_active`. */
var UsageStatusEnum;
(function (UsageStatusEnum) {
    UsageStatusEnum["AVAILABLE"] = "available";
    UsageStatusEnum["RESERVED"] = "reserved";
    UsageStatusEnum["OCCUPIED"] = "occupied";
    UsageStatusEnum["CLEANING"] = "cleaning";
})(UsageStatusEnum || (exports.UsageStatusEnum = UsageStatusEnum = {}));
var DishCategoryEnum;
(function (DishCategoryEnum) {
    /** Chuyển cho bếp */
    DishCategoryEnum["FOOD"] = "food";
    /** Chuyển cho quầy pha chế */
    DishCategoryEnum["DRINK"] = "drink";
})(DishCategoryEnum || (exports.DishCategoryEnum = DishCategoryEnum = {}));
/** Trạng thái kinh doanh của món / combo */
var MenuItemStatusEnum;
(function (MenuItemStatusEnum) {
    MenuItemStatusEnum["ACTIVE"] = "active";
    MenuItemStatusEnum["DISCONTINUED"] = "discontinued";
})(MenuItemStatusEnum || (exports.MenuItemStatusEnum = MenuItemStatusEnum = {}));
/** Đối tượng có thể gắn ảnh (bảng images) */
var ImageEntityEnum;
(function (ImageEntityEnum) {
    ImageEntityEnum["RESTAURANT"] = "restaurant";
    ImageEntityEnum["ROOM"] = "room";
    ImageEntityEnum["DISH"] = "dish";
    ImageEntityEnum["COMBO"] = "combo";
})(ImageEntityEnum || (exports.ImageEntityEnum = ImageEntityEnum = {}));
/** Trạng thái đặt bàn (đặc tả 8.4) */
var ReservationStatusEnum;
(function (ReservationStatusEnum) {
    ReservationStatusEnum["PENDING"] = "pending";
    ReservationStatusEnum["CONFIRMED"] = "confirmed";
    ReservationStatusEnum["ARRIVED"] = "arrived";
    ReservationStatusEnum["COMPLETED"] = "completed";
    ReservationStatusEnum["CANCELLED"] = "cancelled";
    ReservationStatusEnum["NO_SHOW"] = "no_show";
})(ReservationStatusEnum || (exports.ReservationStatusEnum = ReservationStatusEnum = {}));
/** Trạng thái order (đặc tả 4.7) */
var OrderStatusEnum;
(function (OrderStatusEnum) {
    /** Dành cho order khách tự tạo, chờ nhân viên xác nhận (chưa dùng) */
    OrderStatusEnum["PENDING"] = "pending";
    /** Đã mở, chưa gửi món nào */
    OrderStatusEnum["CONFIRMED"] = "confirmed";
    /** Đã gửi ít nhất một đợt gọi món */
    OrderStatusEnum["SERVING"] = "serving";
    OrderStatusEnum["COMPLETED"] = "completed";
    OrderStatusEnum["CANCELLED"] = "cancelled";
    /** Đã gộp vào order khác (`merged_into_order_id`); mọi món và bàn đã chuyển sang order đó */
    OrderStatusEnum["MERGED"] = "merged";
})(OrderStatusEnum || (exports.OrderStatusEnum = OrderStatusEnum = {}));
/** Trạng thái món / combo trong order (đặc tả 4.7) */
var OrderItemStatusEnum;
(function (OrderItemStatusEnum) {
    OrderItemStatusEnum["PENDING"] = "pending";
    OrderItemStatusEnum["CONFIRMED"] = "confirmed";
    OrderItemStatusEnum["COOKING"] = "cooking";
    OrderItemStatusEnum["READY"] = "ready";
    OrderItemStatusEnum["SERVED"] = "served";
    OrderItemStatusEnum["CANCELLED"] = "cancelled";
})(OrderItemStatusEnum || (exports.OrderItemStatusEnum = OrderItemStatusEnum = {}));
/** Nơi chế biến món */
var KitchenStationEnum;
(function (KitchenStationEnum) {
    KitchenStationEnum["KITCHEN"] = "kitchen";
    KitchenStationEnum["BAR"] = "bar";
})(KitchenStationEnum || (exports.KitchenStationEnum = KitchenStationEnum = {}));
var DiscountTypeEnum;
(function (DiscountTypeEnum) {
    /** Giảm theo % tạm tính (có thể giới hạn bằng max_discount) */
    DiscountTypeEnum["PERCENT"] = "percent";
    /** Giảm số tiền cố định */
    DiscountTypeEnum["FIXED"] = "fixed";
})(DiscountTypeEnum || (exports.DiscountTypeEnum = DiscountTypeEnum = {}));
var DiscountStatusEnum;
(function (DiscountStatusEnum) {
    DiscountStatusEnum["ACTIVE"] = "active";
    DiscountStatusEnum["INACTIVE"] = "inactive";
})(DiscountStatusEnum || (exports.DiscountStatusEnum = DiscountStatusEnum = {}));
var PaymentMethodEnum;
(function (PaymentMethodEnum) {
    PaymentMethodEnum["CASH"] = "cash";
    PaymentMethodEnum["CARD"] = "card";
    PaymentMethodEnum["TRANSFER"] = "transfer";
})(PaymentMethodEnum || (exports.PaymentMethodEnum = PaymentMethodEnum = {}));
/** Trạng thái giao dịch (đặc tả 4.8) */
var PaymentStatusEnum;
(function (PaymentStatusEnum) {
    PaymentStatusEnum["PENDING"] = "pending";
    PaymentStatusEnum["PROCESSING"] = "processing";
    PaymentStatusEnum["PAID"] = "paid";
    PaymentStatusEnum["FAILED"] = "failed";
    PaymentStatusEnum["CANCELLED"] = "cancelled";
    /** Payment gốc đã được hoàn hết */
    PaymentStatusEnum["REFUNDED"] = "refunded";
})(PaymentStatusEnum || (exports.PaymentStatusEnum = PaymentStatusEnum = {}));
var PaymentTypeEnum;
(function (PaymentTypeEnum) {
    PaymentTypeEnum["PAYMENT"] = "payment";
    PaymentTypeEnum["REFUND"] = "refund";
})(PaymentTypeEnum || (exports.PaymentTypeEnum = PaymentTypeEnum = {}));
var IngredientStatusEnum;
(function (IngredientStatusEnum) {
    IngredientStatusEnum["ACTIVE"] = "active";
    /** Ngừng dùng: không nhập thêm được, vẫn xuất / kiểm kê được phần còn lại */
    IngredientStatusEnum["INACTIVE"] = "inactive";
})(IngredientStatusEnum || (exports.IngredientStatusEnum = IngredientStatusEnum = {}));
/** Loại phiếu kho */
var InventoryReceiptTypeEnum;
(function (InventoryReceiptTypeEnum) {
    InventoryReceiptTypeEnum["IMPORT"] = "import";
    InventoryReceiptTypeEnum["EXPORT"] = "export";
    /** Kiểm kê: nhập số thực tế, hệ thống ghi chênh lệch */
    InventoryReceiptTypeEnum["ADJUST"] = "adjust";
    /** Hủy hàng hết hạn / hỏng (giai đoạn 11) */
    InventoryReceiptTypeEnum["DISPOSE"] = "dispose";
})(InventoryReceiptTypeEnum || (exports.InventoryReceiptTypeEnum = InventoryReceiptTypeEnum = {}));
/** Loại biến động kho (consume: tự trừ theo định lượng món — chưa dùng) */
var InventoryTransactionTypeEnum;
(function (InventoryTransactionTypeEnum) {
    InventoryTransactionTypeEnum["IMPORT"] = "import";
    InventoryTransactionTypeEnum["EXPORT"] = "export";
    InventoryTransactionTypeEnum["ADJUST"] = "adjust";
    InventoryTransactionTypeEnum["CONSUME"] = "consume";
    InventoryTransactionTypeEnum["DISPOSE"] = "dispose";
    InventoryTransactionTypeEnum["TRANSFER_OUT"] = "transfer_out";
    InventoryTransactionTypeEnum["TRANSFER_IN"] = "transfer_in";
})(InventoryTransactionTypeEnum || (exports.InventoryTransactionTypeEnum = InventoryTransactionTypeEnum = {}));
/** Giai đoạn 11: mua hàng, chuyển kho, công nợ */
var SupplierStatusEnum;
(function (SupplierStatusEnum) {
    SupplierStatusEnum["ACTIVE"] = "active";
    SupplierStatusEnum["INACTIVE"] = "inactive";
})(SupplierStatusEnum || (exports.SupplierStatusEnum = SupplierStatusEnum = {}));
var PurchaseOrderStatusEnum;
(function (PurchaseOrderStatusEnum) {
    PurchaseOrderStatusEnum["DRAFT"] = "draft";
    PurchaseOrderStatusEnum["SENT"] = "sent";
    /** Đã nhận một phần */
    PurchaseOrderStatusEnum["PARTIAL"] = "partial";
    /** Đã nhận đủ mọi dòng */
    PurchaseOrderStatusEnum["RECEIVED"] = "received";
    /** Đóng đơn khi còn thiếu (không chờ nhận thêm) */
    PurchaseOrderStatusEnum["CLOSED"] = "closed";
    PurchaseOrderStatusEnum["CANCELLED"] = "cancelled";
})(PurchaseOrderStatusEnum || (exports.PurchaseOrderStatusEnum = PurchaseOrderStatusEnum = {}));
var StockTransferStatusEnum;
(function (StockTransferStatusEnum) {
    StockTransferStatusEnum["IN_TRANSIT"] = "in_transit";
    StockTransferStatusEnum["RECEIVED"] = "received";
    StockTransferStatusEnum["CANCELLED"] = "cancelled";
})(StockTransferStatusEnum || (exports.StockTransferStatusEnum = StockTransferStatusEnum = {}));
var SupplierBillStatusEnum;
(function (SupplierBillStatusEnum) {
    SupplierBillStatusEnum["UNPAID"] = "unpaid";
    SupplierBillStatusEnum["PARTIAL"] = "partial";
    SupplierBillStatusEnum["PAID"] = "paid";
})(SupplierBillStatusEnum || (exports.SupplierBillStatusEnum = SupplierBillStatusEnum = {}));
/** Giai đoạn 12: nhân sự */
var PayTypeEnum;
(function (PayTypeEnum) {
    /** Lương tháng, chia theo ngày công chuẩn */
    PayTypeEnum["MONTHLY"] = "monthly";
    /** Đơn giá theo giờ */
    PayTypeEnum["HOURLY"] = "hourly";
})(PayTypeEnum || (exports.PayTypeEnum = PayTypeEnum = {}));
var ShiftSwapStatusEnum;
(function (ShiftSwapStatusEnum) {
    /** Chờ người nhận đồng ý */
    ShiftSwapStatusEnum["PENDING_TARGET"] = "pending_target";
    /** Người nhận đã đồng ý, chờ quản lý duyệt */
    ShiftSwapStatusEnum["PENDING_APPROVAL"] = "pending_approval";
    ShiftSwapStatusEnum["APPROVED"] = "approved";
    /** Quản lý từ chối */
    ShiftSwapStatusEnum["REJECTED"] = "rejected";
    /** Người nhận từ chối */
    ShiftSwapStatusEnum["DECLINED"] = "declined";
    ShiftSwapStatusEnum["CANCELLED"] = "cancelled";
})(ShiftSwapStatusEnum || (exports.ShiftSwapStatusEnum = ShiftSwapStatusEnum = {}));
var OvertimeStatusEnum;
(function (OvertimeStatusEnum) {
    OvertimeStatusEnum["NONE"] = "none";
    OvertimeStatusEnum["PENDING"] = "pending";
    OvertimeStatusEnum["APPROVED"] = "approved";
    OvertimeStatusEnum["REJECTED"] = "rejected";
})(OvertimeStatusEnum || (exports.OvertimeStatusEnum = OvertimeStatusEnum = {}));
var LeaveTypeEnum;
(function (LeaveTypeEnum) {
    LeaveTypeEnum["PAID"] = "paid";
    LeaveTypeEnum["UNPAID"] = "unpaid";
})(LeaveTypeEnum || (exports.LeaveTypeEnum = LeaveTypeEnum = {}));
var LeaveStatusEnum;
(function (LeaveStatusEnum) {
    LeaveStatusEnum["PENDING"] = "pending";
    LeaveStatusEnum["APPROVED"] = "approved";
    LeaveStatusEnum["REJECTED"] = "rejected";
    LeaveStatusEnum["CANCELLED"] = "cancelled";
})(LeaveStatusEnum || (exports.LeaveStatusEnum = LeaveStatusEnum = {}));
var AdjustmentTypeEnum;
(function (AdjustmentTypeEnum) {
    AdjustmentTypeEnum["BONUS"] = "bonus";
    AdjustmentTypeEnum["PENALTY"] = "penalty";
})(AdjustmentTypeEnum || (exports.AdjustmentTypeEnum = AdjustmentTypeEnum = {}));
var PayrollStatusEnum;
(function (PayrollStatusEnum) {
    PayrollStatusEnum["DRAFT"] = "draft";
    PayrollStatusEnum["FINALIZED"] = "finalized";
})(PayrollStatusEnum || (exports.PayrollStatusEnum = PayrollStatusEnum = {}));
/** Giai đoạn 13: kênh khách hàng */
var ReservationSourceEnum;
(function (ReservationSourceEnum) {
    ReservationSourceEnum["STAFF"] = "staff";
    ReservationSourceEnum["ONLINE"] = "online";
})(ReservationSourceEnum || (exports.ReservationSourceEnum = ReservationSourceEnum = {}));
var OrderRequestStatusEnum;
(function (OrderRequestStatusEnum) {
    OrderRequestStatusEnum["PENDING"] = "pending";
    OrderRequestStatusEnum["ACCEPTED"] = "accepted";
    OrderRequestStatusEnum["REJECTED"] = "rejected";
})(OrderRequestStatusEnum || (exports.OrderRequestStatusEnum = OrderRequestStatusEnum = {}));
var LoyaltyTransactionTypeEnum;
(function (LoyaltyTransactionTypeEnum) {
    LoyaltyTransactionTypeEnum["EARN"] = "earn";
    LoyaltyTransactionTypeEnum["REDEEM"] = "redeem";
    LoyaltyTransactionTypeEnum["REVOKE"] = "revoke";
    LoyaltyTransactionTypeEnum["ADJUST"] = "adjust";
})(LoyaltyTransactionTypeEnum || (exports.LoyaltyTransactionTypeEnum = LoyaltyTransactionTypeEnum = {}));
var FeedbackStatusEnum;
(function (FeedbackStatusEnum) {
    FeedbackStatusEnum["NEW"] = "new";
    FeedbackStatusEnum["IN_PROGRESS"] = "in_progress";
    FeedbackStatusEnum["RESOLVED"] = "resolved";
})(FeedbackStatusEnum || (exports.FeedbackStatusEnum = FeedbackStatusEnum = {}));
