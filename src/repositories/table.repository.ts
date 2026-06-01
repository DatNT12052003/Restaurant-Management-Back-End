import { pool } from "~/config/db";
import { ITable } from "~/interfaces";

export const getAllTables = async (): Promise<ITable[]> => {
    const query = "SELECT * FROM tables WHERE deleted_at IS NULL";
    const result = await pool.query(query);
    return result.rows;
};
