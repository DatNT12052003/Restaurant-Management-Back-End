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
