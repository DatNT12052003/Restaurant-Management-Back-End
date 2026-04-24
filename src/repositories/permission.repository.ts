import { pool } from "~/config/db";

export const getPermissionsByUserId = async (user_id: number): Promise<string[]> => {
    const query = `
        SELECT DISTINCT p.type_name
        FROM (
            SELECT rp.permission_id
            FROM user_roles ur
            JOIN role_permissions rp ON ur.role_id = rp.role_id
            WHERE ur.user_id = $1

            UNION

            SELECT up.permission_id
            FROM user_permissions up
            WHERE up.user_id = $1
        ) perms
        JOIN permissions p ON p.id = perms.permission_id
    `;

    const values = [user_id];
    const result = await pool.query(query, values);

    return result.rows.map((row) => row.type_name);
};
