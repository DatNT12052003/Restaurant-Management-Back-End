import { IAccount, ICreateAccountPayload, IQueryResult, ISelectQuery, IUpdatePasswordPayload } from "~/interfaces";
import { pool } from "../config/db";
import { buildInsertQuery, buildSelectAllQuery } from "~/utils/query-builder";

export const createAccount = async (payload: ICreateAccountPayload): Promise<IAccount> => {
    const allowedFields = ["username", "hash_password"];
    const returning = ["id", "username", "created_at", "updated_at", "deleted_at"];
    const { query, values }: IQueryResult = buildInsertQuery("accounts", payload, allowedFields, returning);
    const result = await pool.query(query, values);
    return result.rows[0];
};

export const updateAccountPassword = async ({
    payload,
    id,
}: {
    payload: IUpdatePasswordPayload;
    id: number;
}): Promise<void> => {
    const query = `
        UPDATE accounts
        SET hash_password = $1, updated_at = NOW()
        WHERE id = $2 AND deleted_at IS NULL
    `;
    const values = [payload.hash_password, id];
    await pool.query(query, values);
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

export const getAccountById = async (id: number): Promise<IAccount> => {
    const query = `SELECT * FROM accounts WHERE id = $1 AND deleted_at IS NULL`;
    const values = [id];
    const result = await pool.query(query, values);
    return result.rows[0];
};

export const getAccountByUsername = async (username: string): Promise<IAccount> => {
    const query = `SELECT * FROM accounts WHERE username = $1 AND deleted_at IS NULL`;
    const values = [username];
    const result = await pool.query(query, values);
    return result.rows[0];
};
