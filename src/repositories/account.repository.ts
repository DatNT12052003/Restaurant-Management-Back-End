import { ICreateAccount, IQueryResult } from "~/interfaces";
import { pool } from "../config/db";
import { buildInsertQuery, buildSelectQuery } from "~/utils/query-builder";

export const createAccount = async (account: ICreateAccount): Promise<any> => {
    const allowedFields = ["username", "hash_password"];
    const returning = ["id", "username", "created_at", "updated_at", "deleted_at"];
    const { query, values }: IQueryResult = buildInsertQuery("accounts", account, allowedFields, returning);
    const result = await pool.query(query, values);
    return result.rows[0];
};

export const getAccounts = async (params: any) => {
    const allowedFields = ["username", "created_at", "updated_at", "deleted_at"];
    const { query, values } = buildSelectQuery("accounts", allowedFields, params);
    const result = await pool.query(query, values);
    const totalItems = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
    const totalPages = Math.ceil(totalItems / params.limit);
    const rows = result.rows.map(({ total_count, ...data }) => data);

    return { rows, totalItems, totalPages };
};
