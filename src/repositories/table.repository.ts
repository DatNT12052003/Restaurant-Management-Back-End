import { JoinTypeEnum } from "~/common/enum";
import { db } from "~/config/db";
import { ISelectQuery, ITable } from "~/interfaces";
import { buildSelectAllQuery } from "~/utils/query-builder";

/** `restaurantId` = null/undefined: lấy tất cả nhà hàng (chỉ dùng cho admin). */
export const getAllTables = async (restaurantId?: number | null): Promise<ITable[]> => {
    const base = `
        SELECT t.*, r.restaurant_id
        FROM tables t
        JOIN rooms r ON r.id = t.room_id AND r.deleted_at IS NULL
        WHERE t.deleted_at IS NULL`;
    if (restaurantId) {
        const result = await db().query(`${base} AND r.restaurant_id = $1 ORDER BY t.id`, [restaurantId]);
        return result.rows;
    }
    const result = await db().query(`${base} ORDER BY t.id`);
    return result.rows;
};

export const getTables = async (params: ISelectQuery): Promise<{ rows: ITable[]; totalCount: number }> => {
    // Bảng `tables` join `rooms` để lọc theo nhà hàng -> ánh xạ tên field client gửi sang cột có alias
    const fieldMap: Record<string, string> = {
        name: "t.name",
        status: "t.status",
        capacity: "t.capacity",
        room_id: "t.room_id",
        restaurant_id: "r.restaurant_id",
        created_at: "t.created_at",
        updated_at: "t.updated_at",
    };
    const allowedFields = Object.values(fieldMap);

    const { query, values } = buildSelectAllQuery("tables t", allowedFields, {
        ...params,
        joins: [{ type: JoinTypeEnum.INNER, table: "rooms r", on: "r.id = t.room_id AND r.deleted_at IS NULL" }],
        search: params.search?.text
            ? { text: params.search.text, fields: params.search.fields.map((f) => fieldMap[f]).filter(Boolean) }
            : undefined,
        filters: (params.filters || []).map((f) => ({ ...f, field: fieldMap[f.field] })).filter((f) => f.field),
        orderBy: (params.orderBy || []).map((o) => ({ ...o, field: fieldMap[o.field] })).filter((o) => o.field),
    });
    const result = await db().query(query, values);
    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
    const rows = result.rows.map(({ total_count, ...data }) => data);
    return { rows, totalCount };
};
