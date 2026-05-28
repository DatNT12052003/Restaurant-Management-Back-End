import { pool } from "~/config/db";
import { IRole } from "~/interfaces";

export const getRolesByUserId = async (user_id: number): Promise<string[]> => {
    const query = `SELECT r.type_name
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = $1`;
    const result = await pool.query(query, [user_id]);
    return result.rows.map((row) => row.type_name);
};

export const getRoles = async (): Promise<IRole[]> => {
    const query = `SELECT * FROM roles`;
    const result = await pool.query(query);
    return result.rows;
};

export const getRolesByTypeNames = async (roleNames: string[]): Promise<IRole[]> => {
    const query = `SELECT * FROM roles WHERE type_name = ANY($1)`;
    const result = await pool.query(query, [roleNames]);
    return result.rows;
};
