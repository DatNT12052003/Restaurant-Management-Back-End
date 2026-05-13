import { pool } from "~/config/db";
import { ICreateTokenPayload, IToken } from "~/interfaces";
import { buildInsertQuery, buildUpdateQuery } from "~/utils/query-builder";

export const createToken = async (payload: ICreateTokenPayload): Promise<IToken> => {
    const allowedFields = ["jti", "hash_token", "type", "expires_at", "account_id"];
    const returning = ["*"];
    const { query, values } = buildInsertQuery("tokens", payload, allowedFields, returning);
    const result = await pool.query(query, values);
    return result.rows[0];
};

export const getTokenByJti = async (jti: string): Promise<IToken> => {
    const query = `SELECT * FROM tokens WHERE jti = $1 AND deleted_at IS NULL`;
    const values = [jti];
    const result = await pool.query(query, values);
    return result.rows[0];
};

export const getTokenByAccountId = async (account_id: number): Promise<IToken[]> => {
    const query = `SELECT * FROM tokens WHERE account_id = $1 AND deleted_at IS NULL`;
    const values = [account_id];
    const result = await pool.query(query, values);
    return result.rows;
};

export const revokeToken = async (id: number): Promise<IToken> => {
    const allowedFields = ["revoked", "updated_at"];
    const returning = ["*"];
    const payload = { revoked: true, updated_at: new Date() };
    const { query, values } = buildUpdateQuery("tokens", { field: "id", value: id }, payload, allowedFields, returning);
    const result = await pool.query(query, values);
    return result.rows[0];
};

export const revokeAllTokensByAccountId = async (account_id: number): Promise<IToken[]> => {
    const payload = { revoked: true, updated_at: new Date() };
    const { query, values } = buildUpdateQuery(
        "tokens",
        { field: "account_id", value: account_id },
        payload,
        ["revoked", "updated_at"],
        ["*"],
    );
    const result = await pool.query(query, values);
    return result.rows;
};

export const revokeAllRefreshTokensByAccountId = async (account_id: number): Promise<IToken[]> => {
    const query = `
        UPDATE tokens
        SET revoked = true, updated_at = $1
        WHERE account_id = $2 AND type = 'REFRESH' AND deleted_at IS NULL
        RETURNING *
    `;
    const values = [new Date(), account_id];
    const result = await pool.query(query, values);
    return result.rows;
};
