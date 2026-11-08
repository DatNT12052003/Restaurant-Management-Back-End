import {
    IAccount,
    IAccountListItem,
    ICreateAccountPayload,
    IQueryResult,
    ISelectQuery,
    IUpdatePasswordPayload,
    IUpdateUsernamePayload,
} from "~/interfaces";
import { OrderTypeEnum } from "~/common/enum";
import { db } from "~/config/db";
import { buildInsertQuery, buildSelectAllQuery } from "~/utils/query-builder";

export const createAccount = async (payload: ICreateAccountPayload): Promise<IAccount> => {
    const allowedFields = ["username", "hash_password"];
    const returning = ["id", "username", "created_at", "updated_at", "deleted_at"];
    const { query, values }: IQueryResult = buildInsertQuery("accounts", payload, allowedFields, returning);
    const result = await db().query(query, values);
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
    await db().query(query, values);
};

export const getAccounts = async (params: ISelectQuery): Promise<{ rows: IAccount[]; totalCount: number }> => {
    const allowedFields = ["username", "created_at", "updated_at", "deleted_at"];
    const baseTable = "accounts";

    const { query, values } = buildSelectAllQuery(baseTable, allowedFields, params);
    const result = await db().query(query, values);
    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
    const rows = result.rows.map(({ total_count, ...data }) => data);

    return { rows, totalCount };
};

export const getAccountById = async (id: number): Promise<IAccount> => {
    const query = `SELECT * FROM accounts WHERE id = $1 AND deleted_at IS NULL`;
    const values = [id];
    const result = await db().query(query, values);
    return result.rows[0];
};

export const getAccountByUsername = async (username: string): Promise<IAccount> => {
    const query = `SELECT * FROM accounts WHERE username = $1 AND deleted_at IS NULL`;
    const values = [username];
    const result = await db().query(query, values);
    return result.rows[0];
};

export const deleteAccount = async (id: number): Promise<IAccount> => {
    const query = `
        UPDATE accounts
        SET deleted_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING *
    `;
    const values = [id];
    const result = await db().query(query, values);
    return result.rows[0];
};

/** Bỏ qua (trả về tài khoản hiện tại) khi không truyền username mới. */
export const updateAccountUsername = async ({
    payload,
    id,
}: {
    payload: IUpdateUsernamePayload;
    id: number;
}): Promise<IAccount> => {
    if (!payload.username) {
        return getAccountById(id);
    }
    const query = `
        UPDATE accounts
        SET username = $1, updated_at = NOW()
        WHERE id = $2 AND deleted_at IS NULL
        RETURNING *
    `;
    const values = [payload.username, id];
    const result = await db().query(query, values);
    return result.rows[0];
};

/**
 * Ghi nhận một lần đăng nhập sai. Lần sai đầu tiên (hoặc khi cửa sổ cũ đã hết hạn) mở cửa sổ mới; đủ
 * `maxAttempts` lần trong cửa sổ thì khóa tới `locked_until` và đặt lại bộ đếm. Trả về thời điểm hết khóa nếu vừa khóa.
 */
export const registerFailedLogin = async (
    id: number,
    maxAttempts: number,
    windowMinutes: number,
    lockMinutes: number,
): Promise<{ failed_login_count: number; locked_until: Date | null }> => {
    const result = await db().query(
        `UPDATE accounts a SET
            failed_login_count = CASE WHEN s.cnt >= $2 THEN 0 ELSE s.cnt END,
            first_failed_at = CASE WHEN s.cnt >= $2 THEN NULL ELSE s.first END,
            locked_until = CASE WHEN s.cnt >= $2 THEN NOW() + make_interval(mins => $4) ELSE a.locked_until END
        FROM (
            -- Khóa dòng trước khi đếm: hai lần sai đồng thời không bị mất một lần đếm
            SELECT id,
                CASE WHEN first_failed_at IS NULL OR first_failed_at < NOW() - make_interval(mins => $3)
                    THEN 1 ELSE failed_login_count + 1 END AS cnt,
                CASE WHEN first_failed_at IS NULL OR first_failed_at < NOW() - make_interval(mins => $3)
                    THEN NOW() ELSE first_failed_at END AS first
            FROM accounts WHERE id = $1 FOR UPDATE
        ) s
        WHERE a.id = s.id
        RETURNING s.cnt AS failed_login_count, CASE WHEN s.cnt >= $2 THEN a.locked_until END AS locked_until`,
        [id, maxAttempts, windowMinutes, lockMinutes],
    );
    return result.rows[0];
};

/** Đăng nhập thành công: xóa bộ đếm sai, ghi thời điểm đăng nhập */
export const registerSuccessfulLogin = async (id: number): Promise<void> => {
    await db().query(
        `UPDATE accounts SET failed_login_count = 0, first_failed_at = NULL, locked_until = NULL, last_login_at = NOW()
        WHERE id = $1`,
        [id],
    );
};

/** Mở khóa thủ công. Trả về trạng thái trước khi mở (để ghi nhật ký) */
export const unlockAccount = async (id: number): Promise<{ locked_until: Date | null } | undefined> => {
    const result = await db().query(
        `UPDATE accounts a SET failed_login_count = 0, first_failed_at = NULL, locked_until = NULL, updated_at = NOW()
        FROM (SELECT id, locked_until FROM accounts WHERE id = $1 AND deleted_at IS NULL FOR UPDATE) old
        WHERE a.id = old.id
        RETURNING old.locked_until`,
        [id],
    );
    return result.rows[0];
};

const ACCOUNT_FIELD_MAP: Record<string, string> = {
    username: "a.username",
    full_name: "u.full_name",
    restaurant_id: "u.restaurant_id",
    user_status: "u.status",
    last_login_at: "a.last_login_at",
    created_at: "a.created_at",
};

const ACCOUNT_LIST_FIELDS = [
    "a.id",
    "a.username",
    "a.last_login_at",
    "a.locked_until",
    "(a.locked_until IS NOT NULL AND a.locked_until > NOW()) AS is_locked",
    "a.failed_login_count",
    "a.created_at",
    "u.id AS user_id",
    "u.full_name",
    "u.status AS user_status",
    "u.restaurant_id",
    "(SELECT r.name FROM restaurants r WHERE r.id = u.restaurant_id) AS restaurant_name",
    `COALESCE((SELECT array_agg(ro.type_name ORDER BY ro.id) FROM user_roles ur
        JOIN roles ro ON ro.id = ur.role_id AND ro.deleted_at IS NULL
        WHERE ur.user_id = u.id AND ur.deleted_at IS NULL), '{}') AS roles`,
];

/**
 * Danh sách tài khoản kèm người dùng (trang Tài khoản). `conditions` là điều kiện viết sẵn ở service
 * (lọc nhân viên / khách, đang bị khóa); không chứa dữ liệu từ client.
 */
export const getAccountList = async (
    params: ISelectQuery,
): Promise<{ rows: IAccountListItem[]; totalCount: number }> => {
    const map = <T extends { field: string }>(list: T[] = []) =>
        list.map((item) => ({ ...item, field: ACCOUNT_FIELD_MAP[item.field] })).filter((item) => item.field);
    const orderBy = map(params.orderBy);
    const { query, values } = buildSelectAllQuery("accounts a", Object.values(ACCOUNT_FIELD_MAP), {
        ...params,
        joins: [{ table: "users u", on: "u.account_id = a.id AND u.deleted_at IS NULL" }],
        search: params.search
            ? { ...params.search, fields: params.search.fields.map((f) => ACCOUNT_FIELD_MAP[f]).filter(Boolean) }
            : undefined,
        filters: map(params.filters),
        orderBy: orderBy.length ? orderBy : [{ field: "u.full_name", direction: OrderTypeEnum.ASC }],
        returning: ACCOUNT_LIST_FIELDS,
    });
    const result = await db().query(query, values);
    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
    return { rows: result.rows.map(({ total_count, ...data }) => data), totalCount };
};
