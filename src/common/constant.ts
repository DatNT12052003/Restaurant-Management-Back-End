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
};

/** Tối đa số ảnh trong một lần tải lên */
export const MAX_IMAGES_PER_UPLOAD = 10;
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
