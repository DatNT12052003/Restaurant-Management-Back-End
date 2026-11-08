export const GET_ALL_ROOMS = {
    GET_ALL_ROOMS_FAILED: 1,
};

export const ROOM_ERROR = {
    FAILED: 0,
    NOT_FOUND: 1,
    RESTAURANT_NOT_FOUND: 2,
    RESTAURANT_REQUIRED: 3,
    TOO_MANY_TABLES: 4,
    IN_USE: 5,
    /** Có bàn còn reservation chưa kết thúc */
    HAS_RESERVATIONS: 6,
    /** Tạm khóa phòng còn lịch đặt bàn sắp tới: cần gửi lại với `force: true` */
    HAS_UPCOMING_RESERVATIONS: 7,
};
