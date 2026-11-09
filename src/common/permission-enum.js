"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_PERMISSIONS = exports.EInvoicePermissionEnum = exports.LoyaltyPermissionEnum = exports.FeedbackPermissionEnum = exports.OrderRequestPermissionEnum = exports.PayrollPermissionEnum = exports.StaffReviewPermissionEnum = exports.LeavePermissionEnum = exports.AttendancePermissionEnum = exports.ShiftPermissionEnum = exports.HrPermissionEnum = exports.RecipePermissionEnum = exports.AuditLogPermissionEnum = exports.ReportPermissionEnum = exports.IngredientPermissionEnum = exports.PayablePermissionEnum = exports.PurchasePermissionEnum = exports.SupplierPermissionEnum = exports.InventoryPermissionEnum = exports.DiscountPermissionEnum = exports.PaymentPermissionEnum = exports.OrderItemPermissionEnum = exports.OrderPermissionEnum = exports.ReservationPermissionEnum = exports.ComboPermissionEnum = exports.DishPermissionEnum = exports.PermissionManagementEnum = exports.TablePermissionEnum = exports.RoomPermissionEnum = exports.AccountPermissionEnum = exports.RestaurantPermissionEnum = exports.RolePermissionEnum = exports.GuestPermissionEnum = exports.EmployeePermissionEnum = exports.UserPermissionEnum = void 0;
var UserPermissionEnum;
(function (UserPermissionEnum) {
    UserPermissionEnum["CREATE"] = "user.create";
    UserPermissionEnum["VIEW"] = "user.view";
    UserPermissionEnum["UPDATE"] = "user.update";
    UserPermissionEnum["DELETE"] = "user.delete";
})(UserPermissionEnum || (exports.UserPermissionEnum = UserPermissionEnum = {}));
var EmployeePermissionEnum;
(function (EmployeePermissionEnum) {
    EmployeePermissionEnum["CREATE"] = "employee.create";
    EmployeePermissionEnum["VIEW"] = "employee.view";
    EmployeePermissionEnum["UPDATE"] = "employee.update";
    EmployeePermissionEnum["DELETE"] = "employee.delete";
})(EmployeePermissionEnum || (exports.EmployeePermissionEnum = EmployeePermissionEnum = {}));
var GuestPermissionEnum;
(function (GuestPermissionEnum) {
    GuestPermissionEnum["CREATE"] = "guest.create";
    GuestPermissionEnum["VIEW"] = "guest.view";
    GuestPermissionEnum["UPDATE"] = "guest.update";
    GuestPermissionEnum["DELETE"] = "guest.delete";
})(GuestPermissionEnum || (exports.GuestPermissionEnum = GuestPermissionEnum = {}));
var RolePermissionEnum;
(function (RolePermissionEnum) {
    RolePermissionEnum["CREATE"] = "role.create";
    RolePermissionEnum["VIEW"] = "role.view";
    RolePermissionEnum["UPDATE"] = "role.update";
    RolePermissionEnum["DELETE"] = "role.delete";
})(RolePermissionEnum || (exports.RolePermissionEnum = RolePermissionEnum = {}));
var RestaurantPermissionEnum;
(function (RestaurantPermissionEnum) {
    RestaurantPermissionEnum["CREATE"] = "restaurant.create";
    RestaurantPermissionEnum["VIEW"] = "restaurant.view";
    RestaurantPermissionEnum["UPDATE"] = "restaurant.update";
    RestaurantPermissionEnum["DELETE"] = "restaurant.delete";
})(RestaurantPermissionEnum || (exports.RestaurantPermissionEnum = RestaurantPermissionEnum = {}));
var AccountPermissionEnum;
(function (AccountPermissionEnum) {
    AccountPermissionEnum["CREATE"] = "account.create";
    AccountPermissionEnum["VIEW"] = "account.view";
    AccountPermissionEnum["UPDATE"] = "account.update";
    AccountPermissionEnum["DELETE"] = "account.delete";
})(AccountPermissionEnum || (exports.AccountPermissionEnum = AccountPermissionEnum = {}));
var RoomPermissionEnum;
(function (RoomPermissionEnum) {
    RoomPermissionEnum["CREATE"] = "room.create";
    RoomPermissionEnum["VIEW"] = "room.view";
    RoomPermissionEnum["UPDATE"] = "room.update";
    RoomPermissionEnum["DELETE"] = "room.delete";
})(RoomPermissionEnum || (exports.RoomPermissionEnum = RoomPermissionEnum = {}));
var TablePermissionEnum;
(function (TablePermissionEnum) {
    TablePermissionEnum["CREATE"] = "table.create";
    TablePermissionEnum["VIEW"] = "table.view";
    TablePermissionEnum["UPDATE"] = "table.update";
    TablePermissionEnum["DELETE"] = "table.delete";
})(TablePermissionEnum || (exports.TablePermissionEnum = TablePermissionEnum = {}));
var PermissionManagementEnum;
(function (PermissionManagementEnum) {
    PermissionManagementEnum["VIEW"] = "permission.view";
    PermissionManagementEnum["ASSIGN"] = "permission.assign";
})(PermissionManagementEnum || (exports.PermissionManagementEnum = PermissionManagementEnum = {}));
/** Thực đơn chung của chuỗi. Thẻ món (tag) dùng chung nhóm quyền này. */
var DishPermissionEnum;
(function (DishPermissionEnum) {
    DishPermissionEnum["CREATE"] = "dish.create";
    DishPermissionEnum["VIEW"] = "dish.view";
    DishPermissionEnum["UPDATE"] = "dish.update";
    DishPermissionEnum["DELETE"] = "dish.delete";
    /** Bật/tắt món, combo và đặt giá riêng cho nhà hàng của mình */
    DishPermissionEnum["AVAILABILITY"] = "dish.availability";
})(DishPermissionEnum || (exports.DishPermissionEnum = DishPermissionEnum = {}));
var ComboPermissionEnum;
(function (ComboPermissionEnum) {
    ComboPermissionEnum["CREATE"] = "combo.create";
    ComboPermissionEnum["VIEW"] = "combo.view";
    ComboPermissionEnum["UPDATE"] = "combo.update";
    ComboPermissionEnum["DELETE"] = "combo.delete";
})(ComboPermissionEnum || (exports.ComboPermissionEnum = ComboPermissionEnum = {}));
var ReservationPermissionEnum;
(function (ReservationPermissionEnum) {
    ReservationPermissionEnum["CREATE"] = "reservation.create";
    ReservationPermissionEnum["VIEW"] = "reservation.view";
    /** Gồm cả đổi trạng thái (xác nhận, khách đến, hủy...) */
    ReservationPermissionEnum["UPDATE"] = "reservation.update";
    ReservationPermissionEnum["DELETE"] = "reservation.delete";
})(ReservationPermissionEnum || (exports.ReservationPermissionEnum = ReservationPermissionEnum = {}));
var OrderPermissionEnum;
(function (OrderPermissionEnum) {
    OrderPermissionEnum["CREATE"] = "order.create";
    OrderPermissionEnum["VIEW"] = "order.view";
    /** Gọi món, chuyển / thêm bàn, sửa thông tin, hoàn tất order */
    OrderPermissionEnum["UPDATE"] = "order.update";
    /** Hủy order, hủy món đã bắt đầu chế biến */
    OrderPermissionEnum["CANCEL"] = "order.cancel";
})(OrderPermissionEnum || (exports.OrderPermissionEnum = OrderPermissionEnum = {}));
var OrderItemPermissionEnum;
(function (OrderItemPermissionEnum) {
    /** Bếp / pha chế: xác nhận, đang làm, xong */
    OrderItemPermissionEnum["PREPARE"] = "order_item.prepare";
    /** Phục vụ: mang món ra cho khách */
    OrderItemPermissionEnum["SERVE"] = "order_item.serve";
})(OrderItemPermissionEnum || (exports.OrderItemPermissionEnum = OrderItemPermissionEnum = {}));
var PaymentPermissionEnum;
(function (PaymentPermissionEnum) {
    PaymentPermissionEnum["VIEW"] = "payment.view";
    /** Thu tiền, xác nhận / hủy giao dịch chờ */
    PaymentPermissionEnum["CREATE"] = "payment.create";
    PaymentPermissionEnum["REFUND"] = "payment.refund";
    /** Giai đoạn 14: đối soát giao dịch chuyển khoản ngân hàng (SePay) */
    PaymentPermissionEnum["RECONCILE"] = "payment.reconcile";
})(PaymentPermissionEnum || (exports.PaymentPermissionEnum = PaymentPermissionEnum = {}));
var DiscountPermissionEnum;
(function (DiscountPermissionEnum) {
    DiscountPermissionEnum["VIEW"] = "discount.view";
    DiscountPermissionEnum["CREATE"] = "discount.create";
    DiscountPermissionEnum["UPDATE"] = "discount.update";
    DiscountPermissionEnum["DELETE"] = "discount.delete";
    /** Áp / gỡ mã giảm giá cho order */
    DiscountPermissionEnum["APPLY"] = "discount.apply";
})(DiscountPermissionEnum || (exports.DiscountPermissionEnum = DiscountPermissionEnum = {}));
var InventoryPermissionEnum;
(function (InventoryPermissionEnum) {
    InventoryPermissionEnum["VIEW"] = "inventory.view";
    InventoryPermissionEnum["IMPORT"] = "inventory.import";
    InventoryPermissionEnum["EXPORT"] = "inventory.export";
    /** Kiểm kê và đặt ngưỡng tồn tối thiểu */
    InventoryPermissionEnum["ADJUST"] = "inventory.adjust";
    /** Chuyển kho giữa các chi nhánh (giai đoạn 11) */
    InventoryPermissionEnum["TRANSFER"] = "inventory.transfer";
    /** Hủy hàng hết hạn / hỏng */
    InventoryPermissionEnum["DISPOSE"] = "inventory.dispose";
})(InventoryPermissionEnum || (exports.InventoryPermissionEnum = InventoryPermissionEnum = {}));
/** Nhà cung cấp và bảng giá (danh mục dùng chung cả chuỗi) */
var SupplierPermissionEnum;
(function (SupplierPermissionEnum) {
    SupplierPermissionEnum["VIEW"] = "supplier.view";
    SupplierPermissionEnum["MANAGE"] = "supplier.manage";
})(SupplierPermissionEnum || (exports.SupplierPermissionEnum = SupplierPermissionEnum = {}));
/** Đơn đặt hàng nguyên liệu */
var PurchasePermissionEnum;
(function (PurchasePermissionEnum) {
    PurchasePermissionEnum["VIEW"] = "purchase.view";
    PurchasePermissionEnum["CREATE"] = "purchase.create";
    PurchasePermissionEnum["RECEIVE"] = "purchase.receive";
})(PurchasePermissionEnum || (exports.PurchasePermissionEnum = PurchasePermissionEnum = {}));
/** Công nợ nhà cung cấp */
var PayablePermissionEnum;
(function (PayablePermissionEnum) {
    PayablePermissionEnum["VIEW"] = "payable.view";
    PayablePermissionEnum["PAY"] = "payable.pay";
})(PayablePermissionEnum || (exports.PayablePermissionEnum = PayablePermissionEnum = {}));
/** Danh mục nguyên liệu (xem danh mục dùng quyền inventory.view) */
var IngredientPermissionEnum;
(function (IngredientPermissionEnum) {
    IngredientPermissionEnum["CREATE"] = "ingredient.create";
    IngredientPermissionEnum["UPDATE"] = "ingredient.update";
    IngredientPermissionEnum["DELETE"] = "ingredient.delete";
})(IngredientPermissionEnum || (exports.IngredientPermissionEnum = IngredientPermissionEnum = {}));
/** Báo cáo và dashboard (manager chỉ xem chi nhánh của mình) */
var ReportPermissionEnum;
(function (ReportPermissionEnum) {
    ReportPermissionEnum["VIEW"] = "report.view";
})(ReportPermissionEnum || (exports.ReportPermissionEnum = ReportPermissionEnum = {}));
/** Nhật ký hoạt động: chỉ xem, không có quyền sửa / xóa */
var AuditLogPermissionEnum;
(function (AuditLogPermissionEnum) {
    AuditLogPermissionEnum["VIEW"] = "audit_log.view";
})(AuditLogPermissionEnum || (exports.AuditLogPermissionEnum = AuditLogPermissionEnum = {}));
/** Định lượng món và giá vốn (giai đoạn 10) */
var RecipePermissionEnum;
(function (RecipePermissionEnum) {
    RecipePermissionEnum["VIEW"] = "recipe.view";
    RecipePermissionEnum["UPDATE"] = "recipe.update";
})(RecipePermissionEnum || (exports.RecipePermissionEnum = RecipePermissionEnum = {}));
/** Giai đoạn 12: nhân sự */
var HrPermissionEnum;
(function (HrPermissionEnum) {
    /** Lịch làm của mình, chấm công, xin đổi ca / nghỉ phép */
    HrPermissionEnum["SELF"] = "hr.self";
})(HrPermissionEnum || (exports.HrPermissionEnum = HrPermissionEnum = {}));
var ShiftPermissionEnum;
(function (ShiftPermissionEnum) {
    ShiftPermissionEnum["VIEW"] = "shift.view";
    /** Xếp ca, ca mẫu, duyệt đổi ca */
    ShiftPermissionEnum["MANAGE"] = "shift.manage";
})(ShiftPermissionEnum || (exports.ShiftPermissionEnum = ShiftPermissionEnum = {}));
var AttendancePermissionEnum;
(function (AttendancePermissionEnum) {
    AttendancePermissionEnum["VIEW"] = "attendance.view";
    /** Sửa chấm công, duyệt tăng ca */
    AttendancePermissionEnum["MANAGE"] = "attendance.manage";
    /** Hiển thị mã QR chấm công của chi nhánh */
    AttendancePermissionEnum["KIOSK"] = "attendance.kiosk";
})(AttendancePermissionEnum || (exports.AttendancePermissionEnum = AttendancePermissionEnum = {}));
var LeavePermissionEnum;
(function (LeavePermissionEnum) {
    LeavePermissionEnum["APPROVE"] = "leave.approve";
})(LeavePermissionEnum || (exports.LeavePermissionEnum = LeavePermissionEnum = {}));
var StaffReviewPermissionEnum;
(function (StaffReviewPermissionEnum) {
    StaffReviewPermissionEnum["MANAGE"] = "staff_review.manage";
})(StaffReviewPermissionEnum || (exports.StaffReviewPermissionEnum = StaffReviewPermissionEnum = {}));
var PayrollPermissionEnum;
(function (PayrollPermissionEnum) {
    PayrollPermissionEnum["VIEW"] = "payroll.view";
    /** Lương, phụ cấp, thưởng phạt, tính / chốt bảng lương, cấu hình nhân sự */
    PayrollPermissionEnum["MANAGE"] = "payroll.manage";
})(PayrollPermissionEnum || (exports.PayrollPermissionEnum = PayrollPermissionEnum = {}));
/** Giai đoạn 13: kênh khách hàng */
var OrderRequestPermissionEnum;
(function (OrderRequestPermissionEnum) {
    /** Duyệt / từ chối món khách gọi qua QR tại bàn */
    OrderRequestPermissionEnum["HANDLE"] = "order_request.handle";
})(OrderRequestPermissionEnum || (exports.OrderRequestPermissionEnum = OrderRequestPermissionEnum = {}));
var FeedbackPermissionEnum;
(function (FeedbackPermissionEnum) {
    FeedbackPermissionEnum["VIEW"] = "feedback.view";
    FeedbackPermissionEnum["REPLY"] = "feedback.reply";
})(FeedbackPermissionEnum || (exports.FeedbackPermissionEnum = FeedbackPermissionEnum = {}));
var LoyaltyPermissionEnum;
(function (LoyaltyPermissionEnum) {
    /** Tra cứu khách theo SĐT, xem điểm */
    LoyaltyPermissionEnum["VIEW"] = "loyalty.view";
    /** Cấu hình điểm thưởng, điều chỉnh điểm tay */
    LoyaltyPermissionEnum["MANAGE"] = "loyalty.manage";
})(LoyaltyPermissionEnum || (exports.LoyaltyPermissionEnum = LoyaltyPermissionEnum = {}));
/** Toàn bộ permission của hệ thống, dùng cho seed và kiểm tra. */
/** Giai đoạn 14: hóa đơn điện tử */
var EInvoicePermissionEnum;
(function (EInvoicePermissionEnum) {
    EInvoicePermissionEnum["VIEW"] = "einvoice.view";
    /** Phát hành hóa đơn cho order đã hoàn tất, gửi lại hóa đơn lỗi */
    EInvoicePermissionEnum["ISSUE"] = "einvoice.issue";
    EInvoicePermissionEnum["CANCEL"] = "einvoice.cancel";
})(EInvoicePermissionEnum || (exports.EInvoicePermissionEnum = EInvoicePermissionEnum = {}));
exports.ALL_PERMISSIONS = [
    UserPermissionEnum,
    EmployeePermissionEnum,
    GuestPermissionEnum,
    RolePermissionEnum,
    RestaurantPermissionEnum,
    AccountPermissionEnum,
    RoomPermissionEnum,
    TablePermissionEnum,
    PermissionManagementEnum,
    DishPermissionEnum,
    ComboPermissionEnum,
    ReservationPermissionEnum,
    OrderPermissionEnum,
    OrderItemPermissionEnum,
    PaymentPermissionEnum,
    DiscountPermissionEnum,
    InventoryPermissionEnum,
    IngredientPermissionEnum,
    ReportPermissionEnum,
    AuditLogPermissionEnum,
    RecipePermissionEnum,
    SupplierPermissionEnum,
    PurchasePermissionEnum,
    PayablePermissionEnum,
    HrPermissionEnum,
    ShiftPermissionEnum,
    AttendancePermissionEnum,
    LeavePermissionEnum,
    StaffReviewPermissionEnum,
    PayrollPermissionEnum,
    OrderRequestPermissionEnum,
    FeedbackPermissionEnum,
    LoyaltyPermissionEnum,
    EInvoicePermissionEnum,
].flatMap((group) => Object.values(group));
