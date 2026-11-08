export const RECIPE_ERROR = {
    FAILED: 0,
    DISH_NOT_FOUND: 1,
    RESTAURANT_NOT_FOUND: 2,
    /** Có nguyên liệu không tồn tại hoặc đã xóa */
    INVALID_INGREDIENTS: 3,
};

export const CLOSED_DAY_ERROR = {
    FAILED: 0,
    RESTAURANT_NOT_FOUND: 1,
    /** Ngày này đã được đánh dấu nghỉ */
    DUPLICATE: 2,
    NOT_FOUND: 3,
};
