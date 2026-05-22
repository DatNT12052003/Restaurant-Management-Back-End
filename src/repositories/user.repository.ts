import { JoinTypeEnum } from "~/common/enum";
import { pool } from "~/config/db";
import {
    ICreateUserPayload,
    IQueryResult,
    ISelectQuery,
    IUpdateUserPayload,
    IUser,
    IUserWithAccount,
} from "~/interfaces";
import {
    buildInsertQuery,
    buildSelectAllQuery,
    buildSelectByFieldQuery,
    buildUpdateQuery,
} from "~/utils/query-builder";

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
        "restaurant_id",
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

export const getUsersWithAccountInfo = async (
    params: ISelectQuery,
): Promise<{ rows: IUserWithAccount[]; totalCount: number }> => {
    const allowedFields = [
        "u.full_name",
        "u.date_of_birth",
        "u.gender",
        "u.address",
        "u.email",
        "u.phone_number",
        "u.status",
        "u.account_id",
        "u.restaurant_id",
        "u.created_at",
        "a.username",
    ];

    const fieldMap: Record<string, string> = {
        full_name: "u.full_name",
        date_of_birth: "u.date_of_birth",
        gender: "u.gender",
        address: "u.address",
        email: "u.email",
        phone_number: "u.phone_number",
        status: "u.status",
        account_id: "u.account_id",
        restaurant_id: "u.restaurant_id",
        created_at: "u.created_at",
        username: "a.username",
    };

    const finalSearchFields = params.search?.fields.map((f) => fieldMap[f]).filter(Boolean) || [];
    const finalFilterFields =
        params.filters?.map((f) => ({ ...f, field: fieldMap[f.field] })).filter((f) => f.field) || [];
    const finalOrderByFields =
        params.orderBy?.map((o) => ({ ...o, field: fieldMap[o.field] })).filter((o) => o.field) || [];

    const baseTable = "users u";

    const joins = [
        {
            type: JoinTypeEnum.LEFT,
            table: "accounts a",
            on: "u.account_id = a.id",
        },
    ];

    const { query, values } = buildSelectAllQuery(baseTable, allowedFields, {
        ...params,
        joins,
        search: { text: params.search?.text || "", fields: finalSearchFields },
        filters: finalFilterFields,
        orderBy: finalOrderByFields,
    });

    const result = await pool.query(query, values);
    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
    const rows = result.rows.map(({ total_count, ...data }) => data);
    return { rows, totalCount };
};

export const updateUser = async ({ payload, id }: { payload: IUpdateUserPayload; id: number }): Promise<IUser> => {
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
        "restaurant_id",
    ];

    const returning = ["*"];

    const { query, values } = buildUpdateQuery("users", { field: "id", value: id }, payload, allowedFields, returning);
    const result = await pool.query(query, values);
    return result.rows[0];
};

export const deleteUser = async (id: number): Promise<IUser> => {
    const query = `
        UPDATE users
        SET deleted_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING *
    `;
    const values = [id];
    const result = await pool.query(query, values);
    return result.rows[0];
};
