import e from "express";
import { OrderTypeEnum } from "~/common/enum";
import { IQueryResult, ISelectQueryParams } from "~/interfaces";

export const buildInsertQuery = (
    table: string,
    payload: Record<string, any>,
    allowedFields: string[],
    returning: string[] = ["*"],
): IQueryResult => {
    const fields: string[] = [];
    const values: any[] = [];
    const placeholders: string[] = [];

    let index = 1;

    for (const key of allowedFields) {
        if (payload[key] !== undefined) {
            fields.push(key);
            values.push(payload[key]);
            placeholders.push(`$${index++}`);
        }
    }

    if (fields.length === 0) {
        throw new Error("No valid fields to insert");
    }

    const query = `
        INSERT INTO ${table} (${fields.join(", ")})
        VALUES (${placeholders.join(", ")})
        RETURNING ${returning.join(", ")}
    `;

    return { query, values };
};

export const buildSelectQuery = (table: string, allowedFields: string[], params: ISelectQueryParams): IQueryResult => {
    const {
        searchText,
        searchField,
        filterField,
        filterValue,
        orderBy,
        orderType,
        offset,
        limit,
        returning = ["*"],
    } = params;

    const safeSearchField = searchField && allowedFields.includes(searchField) ? searchField : allowedFields[0];
    const safeFilterField = filterField && allowedFields.includes(filterField) ? filterField : null;
    const safeOrderBy = orderBy && allowedFields.includes(orderBy) ? orderBy : "id";
    const safeOrderType = orderType === OrderTypeEnum.DESC ? "DESC" : "ASC";

    const values: any[] = [];
    const conditions: string[] = [];

    if (searchText && safeSearchField) {
        conditions.push(`${safeSearchField} ILIKE $${values.length + 1}`);
        values.push(`%${searchText}%`);
    }

    if (safeFilterField && filterValue !== undefined && filterValue !== null) {
        conditions.push(`${safeFilterField} = $${values.length + 1}`);
        values.push(filterValue);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const selectFields = [...returning, "count(*) OVER() AS total_count"].join(", ");

    const query = `
        SELECT ${selectFields}
        FROM ${table}
        ${whereClause}
        ORDER BY ${safeOrderBy} ${safeOrderType}
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `.trim();

    values.push(limit, offset);

    return { query, values };
};

export const buildUpdateQuery = (
    table: string,
    id: string | number,
    payload: Record<string, any>,
    allowedFields: string[],
    returning: string[] = ["*"],
): IQueryResult => {
    const setClauses: string[] = [];
    const values: any[] = [];
    let index = 1;

    for (const key of allowedFields) {
        if (payload[key] !== undefined) {
            setClauses.push(`${key} = $${index++}`);
            values.push(payload[key]);
        }
    }

    if (setClauses.length === 0) {
        throw new Error("No valid fields to update");
    }

    const idPlaceholder = `$${index++}`;
    values.push(id);

    const query = `
        UPDATE ${table}
        SET ${setClauses.join(", ")}
        WHERE id = ${idPlaceholder}
        RETURNING ${returning.join(", ")}
    `.trim();

    return { query, values };
};

export const buildDeleteQuery = (table: string, id: string | number, returning: string[] = ["*"]): IQueryResult => {
    if (!id) {
        throw new Error("ID is required for delete operation");
    }

    const query = `
        DELETE FROM ${table}
        WHERE id = $1
        RETURNING ${returning.join(", ")}
    `.trim();

    const values = [id];

    return { query, values };
};

export const buildSoftDeleteQuery = (
    table: string,
    id: string | number,
    returning: string[] = ["id", "deleted_at"],
): IQueryResult => {
    if (!id) {
        throw new Error("ID is required for soft delete operation");
    }

    const query = `
        UPDATE ${table}
        SET deleted_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING ${returning.join(", ")}
    `.trim();

    const values = [id];

    return { query, values };
};
