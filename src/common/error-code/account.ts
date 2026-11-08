export const CREATE_ACCOUNT = {
    CREATE_ACCOUNT_FAILED: 0,
};

export const GET_ACCOUNTS = {
    GET_ACCOUNTS_FAILED: 0,
};

export const GET_ACCOUNT_BY_ID = {
    ACCOUNT_NOT_FOUND: 1,
    GET_ACCOUNT_FAILED: 0,
};

export const GET_ACCOUNT_BY_USERNAME = {
    ACCOUNT_NOT_FOUND: 1,
    GET_ACCOUNT_FAILED: 0,
};

/** Quản lý tài khoản của người dùng khác (mở khóa, đăng xuất từ xa, đặt lại mật khẩu) */
export const ACCOUNT_ADMIN = {
    FAILED: 0,
    /** Người dùng không có tài khoản đăng nhập */
    NO_ACCOUNT: 1,
};
