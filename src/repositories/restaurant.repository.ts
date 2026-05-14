import { pool } from "~/config/db";
import { IRestaurant } from "~/interfaces";

export const getAllRestaurants = async (): Promise<IRestaurant[]> => {
    const query = "SELECT * FROM restaurants WHERE deleted_at IS NULL";
    const result = await pool.query(query);
    return result.rows;
};
