export const CREATE_USER = {
    CREATE_USER_FAILED: 0,
};

export const CREATE_USER_WITH_ACCOUNT = {
    CREATE_ACCOUNT_FAILED: 1,
    CREATE_USER_FAILED: 2,
    CREATE_USER_WITH_ACCOUNT_FAILED: 0,
};

export const GET_USER_BY_ACCOUNT_ID = {
    USER_NOT_FOUND: 1,
    GET_USER_BY_ACCOUNT_ID_FAILED: 0,
};

export const GET_USER_BY_EMAIL = {
    USER_NOT_FOUND: 1,
    GET_USER_BY_EMAIL_FAILED: 0,
};

export const GET_EMPLOYEES_BY_RESTAURANT_ID = {
    GET_EMPLOYEES_BY_RESTAURANT_ID_FAILED: 0,
};

export const UPDATE_USER = {
    NOT_FOUND: 1,
    UPDATE_USER_FAILED: 0,
};

export const DELETE_USER = {
    USER_NOT_FOUND: 1,
    ACCOUNT_NOT_FOUND: 2,
    DELETE_USER_FAILED: 0,
};

export const CREATE_EMPLOYEE = {
    CREATE_USER_WITH_ACCOUNT_FAILED: 1,
    ASSIGN_ROLES_FAILED: 2,
    CREATE_EMPLOYEE_FAILED: 0,
};

export const UPDATE_EMPLOYEE = {
    USER_NOT_FOUND: 1,
    ACCOUNT_NOT_FOUND: 2,
    ROLE_NOT_FOUND: 3,
    ADD_ROLES_FAILED: 4,
    REMOVE_ROLES_FAILED: 5,
    UPDATE_EMPLOYEE_FAILED: 0,
};

export const CREATE_GUEST = {
    CREATE_USER_WITH_ACCOUNT_FAILED: 1,
    ASSIGN_ROLES_FAILED: 2,
    CREATE_GUEST_FAILED: 0,
};

export const UPDATE_GUEST = {
    USER_NOT_FOUND: 1,
    ACCOUNT_NOT_FOUND: 2,
    UPDATE_GUEST_FAILED: 0,
};

export const GET_GUESTS = {
    GET_GUESTS_FAILED: 0,
};
//=========================
export const GET_INFO_EMPLOYEE_BY_USER_ID = {
    GET_INFO_EMPLOYEE_BY_USER_ID_FAILED: 0,
};

/** Mã lỗi trùng dữ liệu, dùng chung cho mọi thao tác tạo/sửa user (khác các mã 0-9 ở trên) */
export const USER_DUPLICATE = {
    USERNAME_EXISTS: 101,
    EMAIL_EXISTS: 102,
    PHONE_EXISTS: 103,
};

/** Mã lỗi khi gán vai trò */
export const USER_ROLE_ERROR = {
    INVALID_ROLES: 201,
    ROLE_NOT_ASSIGNABLE: 202,
};
