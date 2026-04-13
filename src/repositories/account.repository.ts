import { ICreateAccount } from "~/interfaces";
import { pool } from "../config/db";
import { buildInsertQuery } from "~/utils/query-builder";

export const createAccount = async (account: ICreateAccount): Promise<any> => {
    const allowedFields = ["username", "hash_password"];
    const returning = ["id", "username", "created_at", "updated_at", "deleted_at"];
    const { query, values } = buildInsertQuery("accounts", account, allowedFields, returning);
    const result = await pool.query(query, values);
    return result.rows[0];
};

export const getAccounts = async (
    offset: number,
    limit: number,
    searchText: string,
    searchField: string,
    filterField: string,
    filterValue: string,
    orderBy: string,
    orderType: string,
): Promise<{ rows: any[]; totalItems: number; totalPages: number }> => {
    let query = `
    SELECT *
    FROM accounts
`;

    const values: any[] = [];
    const conditions: string[] = [];

    if (searchText) {
        conditions.push(`${searchField} ILIKE $${values.length + 1}`);
        values.push(`%${searchText}%`);
    }

    if (filterField && filterValue) {
        conditions.push(`${filterField} = $${values.length + 1}`);
        values.push(filterValue);
    }

    if (conditions.length > 0) {
        query += ` WHERE ` + conditions.join(" AND ");
    }

    query += ` ORDER BY ${orderBy} ${orderType}`;
    query += ` OFFSET $${values.length + 1} LIMIT $${values.length + 2}`;
    values.push(offset, limit);

    const result = await pool.query(query, values);

    const countResult = await pool.query(`SELECT COUNT(*) FROM accounts`);
    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limit);

    return { rows: result.rows, totalItems, totalPages };
};
