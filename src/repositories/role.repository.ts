import { pool } from "~/config/db";
import { buildSelectByFieldQuery, buildSelectByIdQuery } from "~/utils/query-builder";

export const getRolesByUserId = async (user_id: number): Promise<string[]> => {
    const query = `SELECT r.type_name
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = $1`;
    const result = await pool.query(query, [user_id]);
    return result.rows.map((row) => row.type_name);
};
