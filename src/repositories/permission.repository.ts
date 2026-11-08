import { db } from "~/config/db";
import { IPermission } from "~/interfaces";

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

export const getAllPermissions = async (): Promise<IPermission[]> => {
    const result = await db().query(
        "SELECT id, name, type_name FROM permissions WHERE deleted_at IS NULL ORDER BY type_name",
    );
    return result.rows;
};

export const getPermissionsByTypeNames = async (typeNames: string[]): Promise<IPermission[]> => {
    const result = await db().query(
        "SELECT id, name, type_name FROM permissions WHERE deleted_at IS NULL AND type_name = ANY($1)",
        [typeNames],
    );
    return result.rows;
};

/** Quyền của một role (type_name). */
export const getPermissionsByRoleId = async (roleId: number): Promise<string[]> => {
    const result = await db().query(
        `SELECT DISTINCT p.type_name
        FROM role_permissions rp
        JOIN permissions p ON p.id = rp.permission_id AND p.deleted_at IS NULL
        WHERE rp.role_id = $1 AND rp.deleted_at IS NULL`,
        [roleId],
    );
    return result.rows.map((r) => r.type_name);
};

/** Quyền nhận được qua các role của user (không gồm quyền cấp trực tiếp). */
export const getRolePermissionsByUserId = async (userId: number): Promise<string[]> => {
    const result = await db().query(
        `SELECT DISTINCT p.type_name
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
        JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.deleted_at IS NULL
        JOIN permissions p ON p.id = rp.permission_id AND p.deleted_at IS NULL
        WHERE ur.user_id = $1 AND ur.deleted_at IS NULL`,
        [userId],
    );
    return result.rows.map((r) => r.type_name);
};

/** Quyền cấp trực tiếp cho user. */
export const getDirectPermissionsByUserId = async (userId: number): Promise<string[]> => {
    const result = await db().query(
        `SELECT DISTINCT p.type_name
        FROM user_permissions up
        JOIN permissions p ON p.id = up.permission_id AND p.deleted_at IS NULL
        WHERE up.user_id = $1 AND up.deleted_at IS NULL`,
        [userId],
    );
    return result.rows.map((r) => r.type_name);
};

export const addRolePermissions = async (roleId: number, permissionIds: number[]): Promise<void> => {
    if (permissionIds.length === 0) return;
    // Unique index (role_id, permission_id) gồm cả dòng đã xóa mềm -> cấp lại quyền đã gỡ thì khôi phục dòng cũ
    await db().query(
        `INSERT INTO role_permissions (role_id, permission_id) SELECT $1, unnest($2::int[])
        ON CONFLICT (role_id, permission_id) DO UPDATE SET deleted_at = NULL, updated_at = NOW()`,
        [roleId, permissionIds],
    );
};

export const removeRolePermissions = async (roleId: number, permissionIds: number[]): Promise<void> => {
    if (permissionIds.length === 0) return;
    await db().query(
        `UPDATE role_permissions SET deleted_at = NOW(), updated_at = NOW()
        WHERE role_id = $1 AND permission_id = ANY($2::int[]) AND deleted_at IS NULL`,
        [roleId, permissionIds],
    );
};

export const addUserPermissions = async (userId: number, permissionIds: number[]): Promise<void> => {
    if (permissionIds.length === 0) return;
    // Unique index (user_id, permission_id) gồm cả dòng đã xóa mềm -> cấp lại quyền đã gỡ thì khôi phục dòng cũ
    await db().query(
        `INSERT INTO user_permissions (user_id, permission_id) SELECT $1, unnest($2::int[])
        ON CONFLICT (user_id, permission_id) DO UPDATE SET deleted_at = NULL, updated_at = NOW()`,
        [userId, permissionIds],
    );
};

export const removeUserPermissions = async (userId: number, permissionIds: number[]): Promise<void> => {
    if (permissionIds.length === 0) return;
    await db().query(
        `UPDATE user_permissions SET deleted_at = NOW(), updated_at = NOW()
        WHERE user_id = $1 AND permission_id = ANY($2::int[]) AND deleted_at IS NULL`,
        [userId, permissionIds],
    );
};
