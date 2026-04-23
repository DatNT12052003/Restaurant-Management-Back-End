import { pool } from "~/config/db";
import { buildInsertQuery } from "~/utils/query-builder";

export const createUser = async (payload: any) => {
    const allowedFields = [
        "full_name",
        "date_of_birth",
        "gender",
        "address",
        "email",
        "phone_number",
        "avatar_url",
        "status",
        "account_id",
    ];
    const returning = ["*"];
    const { query, values } = buildInsertQuery("users", payload, allowedFields, returning);
    const result = await pool.query(query, values);
    return result.rows[0];
};
