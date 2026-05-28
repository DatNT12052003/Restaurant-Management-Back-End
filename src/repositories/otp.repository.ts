import { pool } from "~/config/db";
import { ICreateOtpPayload, IGetActiveOtp, IOtp } from "~/interfaces";
import { buildInsertQuery } from "~/utils/query-builder";

export const createOtp = async (data: ICreateOtpPayload): Promise<IOtp> => {
    const allowedFields = ["hash_code", "type", "expires_at", "account_id"];
    const returning = ["*"];
    const { query, values } = buildInsertQuery("otps", data, allowedFields, returning);
    const result = await pool.query(query, values);
    return result.rows[0];
};

export const getActiveOtpByAccountIdAndType = async ({ account_id, type }: IGetActiveOtp): Promise<IOtp> => {
    const query = `
        SELECT *
        FROM otps
        WHERE account_id = $1 AND type = $2 AND is_used = false AND expires_at > NOW() AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
    `;
    const values = [account_id, type];
    const result = await pool.query(query, values);
    return result.rows[0];
};

export const markOtpAsUsed = async (id: number): Promise<void> => {
    const query = `
        UPDATE otps
        SET is_used = true, updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
    `;
    const values = [id];
    await pool.query(query, values);
};
