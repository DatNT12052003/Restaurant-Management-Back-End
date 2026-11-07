import { db } from "~/config/db";
import { IRole } from "~/interfaces";

export const getRolesByUserId = async (user_id: number): Promise<string[]> => {
    const query = `SELECT r.type_name
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = $1 AND ur.deleted_at IS NULL AND r.deleted_at IS NULL`;
    const result = await db().query(query, [user_id]);
    return result.rows.map((row) => row.type_name);
};

export const getRoles = async (): Promise<IRole[]> => {
    const query = `SELECT * FROM roles WHERE deleted_at IS NULL`;
    const result = await db().query(query);
    return result.rows;
};

export const getRolesByTypeNames = async (roleNames: string[]): Promise<IRole[]> => {
    const query = `SELECT * FROM roles WHERE type_name = ANY($1) AND deleted_at IS NULL`;
    const result = await db().query(query, [roleNames]);
    return result.rows;
};

export const getRoleById = async (id: number): Promise<IRole | undefined> => {
    const result = await db().query("SELECT * FROM roles WHERE id = $1 AND deleted_at IS NULL", [id]);
    return result.rows[0];
};

/** Danh sách role kèm mảng permission (type_name) và số user đang giữ role. */
export const getRolesWithPermissions = async (): Promise<(IRole & { permissions: string[]; user_count: number })[]> => {
    const result = await db().query(`
        SELECT r.id, r.name, r.type_name,
            COALESCE((
                SELECT array_agg(DISTINCT p.type_name ORDER BY p.type_name)
                FROM role_permissions rp
                JOIN permissions p ON p.id = rp.permission_id AND p.deleted_at IS NULL
                WHERE rp.role_id = r.id AND rp.deleted_at IS NULL
            ), '{}') AS permissions,
            (
                SELECT COUNT(DISTINCT ur.user_id)::int
                FROM user_roles ur
                JOIN users u ON u.id = ur.user_id AND u.deleted_at IS NULL
                WHERE ur.role_id = r.id AND ur.deleted_at IS NULL
            ) AS user_count
        FROM roles r
        WHERE r.deleted_at IS NULL
        ORDER BY r.id
    `);
    return result.rows;
};
