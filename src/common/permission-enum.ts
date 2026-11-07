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
].flatMap((group) => Object.values(group) as string[]);
