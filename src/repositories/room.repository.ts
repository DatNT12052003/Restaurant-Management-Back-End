import { pool } from "~/config/db";
import { IRoom } from "~/interfaces";

export const getAllRooms = async (): Promise<IRoom[]> => {
    const query = "SELECT * FROM rooms WHERE deleted_at IS NULL";
    const result = await pool.query(query);
    return result.rows;
};
