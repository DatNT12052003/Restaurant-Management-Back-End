import { pool } from "~/config/db";
import { IRoom, ISelectQuery } from "~/interfaces";
import { buildSelectAllQuery } from "~/utils/query-builder";

export const getAllRooms = async (): Promise<IRoom[]> => {
    const query = "SELECT * FROM rooms WHERE deleted_at IS NULL";
    const result = await pool.query(query);
    return result.rows;
};

export const getRooms = async (params: ISelectQuery): Promise<{ rows: IRoom[]; totalCount: number }> => {
    const allowedFields = [
        "name",
        "type",
        "status",
        "description",
        "restaurant_id",
        "created_at",
        "updated_at",
        "deleted_at",
    ];
    const baseTable = "rooms";
    const { query, values } = buildSelectAllQuery(baseTable, allowedFields, params);
    const result = await pool.query(query, values);
    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
    const rows = result.rows.map(({ total_count, ...data }) => data);
    return { rows, totalCount };
};
