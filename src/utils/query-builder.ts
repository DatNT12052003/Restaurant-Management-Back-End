import { OrderTypeEnum } from "~/common/enum";
import { IQueryResult } from "~/interfaces";

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

export const buildSelectQuery = (
    table: string,
    allowedFields: string[],
    params: {
        searchText?: string;
        searchField?: string;
        filterField?: string;
        filterValue?: any;
        orderBy?: string;
        orderType?: OrderTypeEnum;
        offset: number;
        limit: number;
        returning?: string[];
    },
): IQueryResult => {
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
