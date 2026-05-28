import { pool } from "~/config/db";
import { ICreateUserRoleBody } from "~/interfaces";

export const assignRoleToUser = async (payload: ICreateUserRoleBody): Promise<boolean> => {
    try {
        const insertQuery = `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`;
        await pool.query(insertQuery, [payload.user_id, payload.role_id]);
        return true;
    } catch (error) {
        return false;
    }
};

export const assignRolesToUser = async (user_id: number, role_ids: number[]): Promise<boolean> => {
    try {
        const insertQuery = `INSERT INTO user_roles (user_id, role_id) VALUES ($1, unnest($2::int[]))`;
        await pool.query(insertQuery, [user_id, role_ids]);
        return true;
    } catch (error) {
        return false;
    }
};

export const removeRolesFromUser = async (user_id: number, role_ids: number[]): Promise<boolean> => {
    try {
        const removeQuery = `UPDATE user_roles SET deleted_at = NOW() WHERE user_id = $1 AND role_id = ANY($2) AND deleted_at IS NULL`;
        await pool.query(removeQuery, [user_id, role_ids]);
        return true;
    } catch (error) {
        return false;
    }
};
