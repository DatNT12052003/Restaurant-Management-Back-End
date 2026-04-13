import { pool } from "~/config/db";
import { ICreateEmployeePayload } from "~/interfaces";
import { buildInsertQuery } from "~/utils/query-builder";

export const createEmployee = async (payload: any) => {
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
    const { query, values } = buildInsertQuery("employees", payload, allowedFields, returning);
    const result = await pool.query(query, values);
    return result.rows[0];
};
