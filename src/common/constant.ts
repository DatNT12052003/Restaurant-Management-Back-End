export const PAGINATION = {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 10,
    DEFAULT_OFFSET: 0,
};

export const SALT_ROUNDS = 10;

export const MAX_PAGE_LIMIT = 100;

/** Phòng private / private_pro tối đa 5 bàn (đặc tả 3.2) */
export const MAX_TABLES_PER_PRIVATE_ROOM = 5;

/** Mã lỗi PostgreSQL */
export const PG_ERROR = {
    UNIQUE_VIOLATION: "23505",
    FOREIGN_KEY_VIOLATION: "23503",
    CHECK_VIOLATION: "23514",
    /** Vi phạm exclusion constraint (ví dụ: bàn bị đặt trùng giờ) */
    EXCLUSION_VIOLATION: "23P01",
};

/** Tối đa số ảnh trong một lần tải lên */
export const MAX_IMAGES_PER_UPLOAD = 10;
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

/** Đặt bàn: thời lượng tối đa của một lần đặt (giờ) */
export const MAX_RESERVATION_HOURS = 12;
/** Đặt bàn: cho phép giờ bắt đầu sớm hơn hiện tại tối đa bấy nhiêu phút (ghi nhận khách vừa tới) */
export const RESERVATION_PAST_GRACE_MINUTES = 15;
/** Lịch đặt bàn: khoảng thời gian tối đa của một lần truy vấn (ngày) */
export const MAX_SCHEDULE_RANGE_DAYS = 31;

/** Khóa tài khoản: sai mật khẩu LOGIN_MAX_ATTEMPTS lần trong LOGIN_WINDOW_MINUTES phút thì khóa LOGIN_LOCK_MINUTES phút */
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_WINDOW_MINUTES = 15;
export const LOGIN_LOCK_MINUTES = 15;

/** Nhật ký hoạt động: dòng cũ hơn bấy nhiêu tháng được chuyển sang `audit_logs_archive` (câu hỏi 13) */
export const AUDIT_RETENTION_MONTHS = 12;
