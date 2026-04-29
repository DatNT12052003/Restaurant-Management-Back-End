export enum OTPTypeEnum {
    RESET_PASSWORD = "RESET_PASSWORD",
    VERIFY_EMAIL = "VERIFY_EMAIL",
    LOGIN = "LOGIN",
    CHANGE_EMAIL = "CHANGE_EMAIL",
    TWO_FA = "TWO_FA",
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
    MALE = "male",
    FEMALE = "female",
    OTHER = "other",
}

export enum UserStatusEnum {
    ACTIVE = "active",
    INACTIVE = "inactive",
}

export enum GuestStatusEnum {
    NEW = "new",
    REGULAR = "regular",
}
