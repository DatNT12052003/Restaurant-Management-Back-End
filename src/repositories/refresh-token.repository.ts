import { pool } from "~/config/db";
import { buildInsertQuery, buildUpdateQuery } from "~/utils/query-builder";

export const createRefreshToken = async (payload: any) => {
    const allowedFields = ["token", "expires_at", "account_id"];
    const returning = ["*"];
    const { query, values } = buildInsertQuery("refresh_tokens", payload, allowedFields, returning);
    const result = await pool.query(query, values);
    return result.rows[0];
};

export const revokeRefreshToken = async (id: number) => {
    const allowedFields = ["revoked", "updated_at"];
    const returning = ["*"];
    const payload = { revoked: true, updated_at: new Date() };
    const { query, values } = buildUpdateQuery("refresh_tokens", id, payload, allowedFields, returning);
    const result = await pool.query(query, values);
    return result.rows[0];
};
