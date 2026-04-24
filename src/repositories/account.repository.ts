import { IAccount, ICreateAccount, IQueryResult, ISelectQuery } from "~/interfaces";
import { pool } from "../config/db";
import { buildInsertQuery, buildSelectAllQuery } from "~/utils/query-builder";

export const createAccount = async (account: ICreateAccount): Promise<IAccount> => {
    const allowedFields = ["username", "hash_password"];
    const returning = ["id", "username", "created_at", "updated_at", "deleted_at"];
    const { query, values }: IQueryResult = buildInsertQuery("accounts", account, allowedFields, returning);
    const result = await pool.query(query, values);
    return result.rows[0];
};

export const getAccounts = async (params: ISelectQuery): Promise<{ rows: IAccount[]; totalCount: number }> => {
    const allowedFields = ["username", "created_at", "updated_at", "deleted_at"];
    const baseTable = "accounts";

    const { query, values } = buildSelectAllQuery(baseTable, allowedFields, params);
    const result = await pool.query(query, values);
    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
    const rows = result.rows.map(({ total_count, ...data }) => data);

    return { rows, totalCount };
};

export const getAccountByUsername = async (username: string): Promise<IAccount> => {
    const query = `SELECT * FROM accounts WHERE username = $1 AND deleted_at IS NULL`;
    const values = [username];
    const result = await pool.query(query, values);
    return result.rows[0];
};
