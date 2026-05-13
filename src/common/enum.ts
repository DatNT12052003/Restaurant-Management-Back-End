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
