export enum UserPermissionEnum {
    CREATE = "user.create",
    VIEW = "user.view",
    UPDATE = "user.update",
    DELETE = "user.delete",
}

export enum EmployeePermissionEnum {
    CREATE = "employee.create",
    VIEW = "employee.view",
    UPDATE = "employee.update",
    DELETE = "employee.delete",
}

export enum GuestPermissionEnum {
    CREATE = "guest.create",
    VIEW = "guest.view",
    UPDATE = "guest.update",
    DELETE = "guest.delete",
}

export enum RolePermissionEnum {
    CREATE = "role.create",
    VIEW = "role.view",
    UPDATE = "role.update",
    DELETE = "role.delete",
}

export enum RestaurantPermissionEnum {
    CREATE = "restaurant.create",
    VIEW = "restaurant.view",
    UPDATE = "restaurant.update",
    DELETE = "restaurant.delete",
}

export enum AccountPermissionEnum {
    CREATE = "account.create",
    VIEW = "account.view",
    UPDATE = "account.update",
    DELETE = "account.delete",
}

export enum RoomPermissionEnum {
    CREATE = "room.create",
    VIEW = "room.view",
    UPDATE = "room.update",
    DELETE = "room.delete",
}

export enum TablePermissionEnum {
    CREATE = "table.create",
    VIEW = "table.view",
    UPDATE = "table.update",
    DELETE = "table.delete",
}

export enum PermissionManagementEnum {
    VIEW = "permission.view",
    ASSIGN = "permission.assign",
}

/** Thực đơn chung của chuỗi. Thẻ món (tag) dùng chung nhóm quyền này. */
export enum DishPermissionEnum {
    CREATE = "dish.create",
    VIEW = "dish.view",
    UPDATE = "dish.update",
    DELETE = "dish.delete",
    /** Bật/tắt món, combo và đặt giá riêng cho nhà hàng của mình */
    AVAILABILITY = "dish.availability",
}

export enum ComboPermissionEnum {
    CREATE = "combo.create",
    VIEW = "combo.view",
    UPDATE = "combo.update",
    DELETE = "combo.delete",
}

export enum ReservationPermissionEnum {
    CREATE = "reservation.create",
    VIEW = "reservation.view",
    /** Gồm cả đổi trạng thái (xác nhận, khách đến, hủy...) */
    UPDATE = "reservation.update",
    DELETE = "reservation.delete",
}

export enum OrderPermissionEnum {
    CREATE = "order.create",
    VIEW = "order.view",
    /** Gọi món, chuyển / thêm bàn, sửa thông tin, hoàn tất order */
    UPDATE = "order.update",
    /** Hủy order, hủy món đã bắt đầu chế biến */
    CANCEL = "order.cancel",
}

export enum OrderItemPermissionEnum {
    /** Bếp / pha chế: xác nhận, đang làm, xong */
    PREPARE = "order_item.prepare",
    /** Phục vụ: mang món ra cho khách */
    SERVE = "order_item.serve",
}

export enum PaymentPermissionEnum {
    VIEW = "payment.view",
    /** Thu tiền, xác nhận / hủy giao dịch chờ */
    CREATE = "payment.create",
    REFUND = "payment.refund",
}

export enum DiscountPermissionEnum {
    VIEW = "discount.view",
    CREATE = "discount.create",
    UPDATE = "discount.update",
    DELETE = "discount.delete",
    /** Áp / gỡ mã giảm giá cho order */
    APPLY = "discount.apply",
}

export enum InventoryPermissionEnum {
    VIEW = "inventory.view",
    IMPORT = "inventory.import",
    EXPORT = "inventory.export",
    /** Kiểm kê và đặt ngưỡng tồn tối thiểu */
    ADJUST = "inventory.adjust",
}

/** Danh mục nguyên liệu (xem danh mục dùng quyền inventory.view) */
export enum IngredientPermissionEnum {
    CREATE = "ingredient.create",
    UPDATE = "ingredient.update",
    DELETE = "ingredient.delete",
}

/** Toàn bộ permission của hệ thống, dùng cho seed và kiểm tra. */
export const ALL_PERMISSIONS: string[] = [
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
].flatMap((group) => Object.values(group) as string[]);
