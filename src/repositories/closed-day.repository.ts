import { db } from "~/config/db";
import { IClosedDay } from "~/interfaces";

const SELECT = `SELECT cd.restaurant_id, to_char(cd.day, 'YYYY-MM-DD') AS day, cd.note, cd.created_by, cd.created_at,
    (SELECT u.full_name FROM users u WHERE u.id = cd.created_by) AS created_by_name
    FROM restaurant_closed_days cd`;

/** Ngày nghỉ của chi nhánh trong khoảng (bỏ trống = tất cả), mới nhất trước */
export const getClosedDays = async (restaurantId: number, from?: string, to?: string): Promise<IClosedDay[]> => {
    const result = await db().query(
        `${SELECT}
        WHERE cd.restaurant_id = $1 AND ($2::date IS NULL OR cd.day >= $2::date) AND ($3::date IS NULL OR cd.day <= $3::date)
        ORDER BY cd.day DESC`,
        [restaurantId, from ?? null, to ?? null],
    );
    return result.rows;
};

export const getClosedDay = async (restaurantId: number, day: string): Promise<IClosedDay | undefined> => {
    const result = await db().query(`${SELECT} WHERE cd.restaurant_id = $1 AND cd.day = $2::date`, [restaurantId, day]);
    return result.rows[0];
};

export const createClosedDay = async (row: {
    restaurant_id: number;
    day: string;
    note: string | null;
    created_by: number | null;
}): Promise<void> => {
    await db().query(
        "INSERT INTO restaurant_closed_days (restaurant_id, day, note, created_by) VALUES ($1, $2::date, $3, $4)",
        [row.restaurant_id, row.day, row.note, row.created_by],
    );
};

/** Ngày nghỉ là cấu hình (không phải dữ liệu nghiệp vụ): xóa cứng; thao tác được ghi nhật ký */
export const deleteClosedDay = async (restaurantId: number, day: string): Promise<boolean> => {
    const result = await db().query("DELETE FROM restaurant_closed_days WHERE restaurant_id = $1 AND day = $2::date", [
        restaurantId,
        day,
    ]);
    return (result.rowCount ?? 0) > 0;
};
