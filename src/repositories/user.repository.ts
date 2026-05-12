import { pool } from "~/config/db";
import { ICreateUserPayload, IQueryResult, IUser } from "~/interfaces";
import { buildInsertQuery, buildSelectByFieldQuery } from "~/utils/query-builder";

export const createUser = async (payload: ICreateUserPayload): Promise<IUser> => {
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
    const { query, values }: IQueryResult = buildInsertQuery("users", payload, allowedFields, returning);
    const result = await pool.query(query, values);
    return result.rows[0];
};

export const getUserByAccountId = async (account_id: number): Promise<IUser> => {
    const { query, values }: IQueryResult = buildSelectByFieldQuery("users", "account_id", account_id, ["*"]);
    const result = await pool.query(query, values);
    return result.rows[0];
};

export const getUserByEmail = async (email: string): Promise<IUser> => {
    const { query, values }: IQueryResult = buildSelectByFieldQuery("users", "email", email, ["*"]);
    const result = await pool.query(query, values);
    return result.rows[0];
};
