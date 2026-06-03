import { pool } from "~/config/db";
import { ISelectQuery, ITable } from "~/interfaces";
import { buildSelectAllQuery } from "~/utils/query-builder";

export const getAllTables = async (): Promise<ITable[]> => {
    const query = "SELECT * FROM tables WHERE deleted_at IS NULL";
    const result = await pool.query(query);
    return result.rows;
};

export const getTables = async (params: ISelectQuery): Promise<{ rows: ITable[]; totalCount: number }> => {
    const allowedFields = ["name", "status", "room_id", "created_at", "updated_at", "deleted_at"];
    const baseTable = "tables";
    const { query, values } = buildSelectAllQuery(baseTable, allowedFields, params);
    const result = await pool.query(query, values);
    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
    const rows = result.rows.map(({ total_count, ...data }) => data);
    return { rows, totalCount };
};
