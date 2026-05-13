import { pool } from "~/config/db";
import { IRestaurant, ISelectQuery } from "~/interfaces";
import { buildSelectAllQuery } from "~/utils/query-builder";

export const getRestaurants = async (params: ISelectQuery): Promise<{ rows: IRestaurant[]; totalCount: number }> => {
    const allowedFields = ["name", "status", "address", "created_at", "updated_at", "deleted_at"];
    const baseTable = "restaurants";

    const { query, values } = buildSelectAllQuery(baseTable, allowedFields, params);
    const result = await pool.query(query, values);
    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
    const rows = result.rows.map(({ total_count, ...data }) => data);

    return { rows, totalCount };
};
