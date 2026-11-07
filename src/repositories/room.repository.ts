import { db } from "~/config/db";
import { IRoom, ISelectQuery } from "~/interfaces";
import { buildSelectAllQuery } from "~/utils/query-builder";

/** `restaurantId` = null/undefined: lấy tất cả nhà hàng (chỉ dùng cho admin). */
export const getAllRooms = async (restaurantId?: number | null): Promise<IRoom[]> => {
    if (restaurantId) {
        const result = await db().query(
            "SELECT * FROM rooms WHERE deleted_at IS NULL AND restaurant_id = $1 ORDER BY id",
            [restaurantId],
        );
        return result.rows;
    }
    const result = await db().query("SELECT * FROM rooms WHERE deleted_at IS NULL ORDER BY id");
    return result.rows;
};

export const getRooms = async (params: ISelectQuery): Promise<{ rows: IRoom[]; totalCount: number }> => {
    const allowedFields = [
        "name",
        "type",
        "status",
        "is_active",
        "description",
        "restaurant_id",
        "created_at",
        "updated_at",
        "deleted_at",
    ];
    const baseTable = "rooms";
    const { query, values } = buildSelectAllQuery(baseTable, allowedFields, params);
    const result = await db().query(query, values);
    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
    const rows = result.rows.map(({ total_count, ...data }) => data);
    return { rows, totalCount };
};
