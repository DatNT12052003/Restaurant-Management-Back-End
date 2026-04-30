export enum OTPTypeEnum {
    RESET_PASSWORD = "RESET_PASSWORD",
    VERIFY_EMAIL = "VERIFY_EMAIL",
    LOGIN = "LOGIN",
    CHANGE_EMAIL = "CHANGE_EMAIL",
    TWO_FA = "TWO_FA",
}

export enum TokenTypeEnum {
    ACCESS = "ACCESS",
    REFRESH = "REFRESH",
    RESET_PASSWORD = "RESET_PASSWORD",
}

export enum FilterOperatorEnum {
    EQUAL = "=",
    NOT_EQUAL = "!=",
    GREATER_THAN = ">",
    LESS_THAN = "<",
    ILIKE = "ILIKE",
    IN = "IN",
    IS = "IS",
}

export enum OrderTypeEnum {
    ASC = "ASC",
    DESC = "DESC",
}

export enum JoinTypeEnum {
    INNER = "INNER",
    LEFT = "LEFT",
    RIGHT = "RIGHT",
}

export enum GenderEnum {
    MALE = "MALE",
    FEMALE = "FEMALE",
    OTHER = "OTHER",
}

export enum UserStatusEnum {
    ACTIVE = "ACTIVE",
    INACTIVE = "INACTIVE",
}

export enum GuestStatusEnum {
    NEW = "NEW",
    REGULAR = "REGULAR",
}
