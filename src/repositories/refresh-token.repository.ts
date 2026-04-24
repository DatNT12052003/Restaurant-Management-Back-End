import { pool } from "~/config/db";
import { ICreateRefreshTokenPayload, IRefreshToken } from "~/interfaces";
import { buildInsertQuery, buildUpdateQuery } from "~/utils/query-builder";

export const createRefreshToken = async (payload: ICreateRefreshTokenPayload): Promise<IRefreshToken> => {
    const allowedFields = ["jti", "hash_token", "expires_at", "account_id"];
    const returning = ["*"];
    const { query, values } = buildInsertQuery("refresh_tokens", payload, allowedFields, returning);
    const result = await pool.query(query, values);
    return result.rows[0];
};

export const getRefreshTokenByJti = async (jti: string): Promise<IRefreshToken> => {
    const query = `SELECT * FROM refresh_tokens WHERE jti = $1 AND deleted_at IS NULL`;
    const values = [jti];
    const result = await pool.query(query, values);
    return result.rows[0];
};

export const getRefreshTokensByAccountId = async (account_id: number): Promise<IRefreshToken[]> => {
    const query = `SELECT * FROM refresh_tokens WHERE account_id = $1 AND deleted_at IS NULL`;
    const values = [account_id];
    const result = await pool.query(query, values);
    return result.rows;
};

export const revokeRefreshToken = async (id: number): Promise<IRefreshToken> => {
    const allowedFields = ["revoked", "updated_at"];
    const returning = ["*"];
    const payload = { revoked: true, updated_at: new Date() };
    const { query, values } = buildUpdateQuery(
        "refresh_tokens",
        { field: "id", value: id },
        payload,
        allowedFields,
        returning,
    );
    const result = await pool.query(query, values);
    return result.rows[0];
};

export const revokeAllRefreshTokensByAccountId = async (account_id: number): Promise<IRefreshToken[]> => {
    const payload = { revoked: true, updated_at: new Date() };
    const { query, values } = buildUpdateQuery(
        "refresh_tokens",
        { field: "account_id", value: account_id },
        payload,
        ["revoked", "updated_at"],
        ["*"],
    );
    const result = await pool.query(query, values);
    return result.rows;
};
