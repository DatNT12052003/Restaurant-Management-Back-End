import { db } from "~/config/db";

export const getPermissionsByUserId = async (user_id: number): Promise<string[]> => {
    const query = `
        SELECT DISTINCT p.type_name
        FROM (
            SELECT rp.permission_id
            FROM user_roles ur
            JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
            JOIN role_permissions rp ON ur.role_id = rp.role_id AND rp.deleted_at IS NULL
            WHERE ur.user_id = $1 AND ur.deleted_at IS NULL

            UNION

            SELECT up.permission_id
            FROM user_permissions up
            WHERE up.user_id = $1 AND up.deleted_at IS NULL
        ) perms
        JOIN permissions p ON p.id = perms.permission_id AND p.deleted_at IS NULL
    `;

    const values = [user_id];
    const result = await db().query(query, values);

    return result.rows.map((row) => row.type_name);
};
