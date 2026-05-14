import { IQueryResult, ISelectQuery } from "~/interfaces";

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

export const buildSelectAllQuery = (baseTable: string, allowedFields: string[], params: ISelectQuery): IQueryResult => {
    const { search, filters = [], orderBy = [], offset, limit, joins = [], returning = ["*"] } = params;

    const values: any[] = [];
    const conditions: string[] = [];

    const joinClause = joins.map((j) => `${j.type || "INNER"} JOIN ${j.table} ON ${j.on}`).join(" ");

    if (search?.text && search.fields.length > 0) {
        const searchConditions = search.fields
            .filter((f) => allowedFields.includes(f))
            .map((field) => {
                values.push(`%${search.text}%`);
                return `${field} ILIKE $${values.length}`;
            });

        if (searchConditions.length > 0) {
            conditions.push(`(${searchConditions.join(" OR ")})`);
        }
    }

    filters.forEach((f) => {
        if (!allowedFields.includes(f.field)) return;

        const operator = f.operator || "=";

        if (operator === "in" && Array.isArray(f.value)) {
            const placeholders = f.value.map((v) => {
                values.push(v);
                return `$${values.length}`;
            });
            conditions.push(`${f.field} IN (${placeholders.join(", ")})`);
        } else if (operator === "is") {
            conditions.push(`${f.field} IS ${f.value === null ? "NULL" : "NOT NULL"}`);
        } else {
            values.push(operator === "ilike" ? `%${f.value}%` : f.value);
            conditions.push(`${f.field} ${operator} $${values.length}`);
        }
    });

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const orderClause =
        orderBy.length > 0
            ? orderBy
                  .filter((o) => allowedFields.includes(o.field))
                  .map((o) => `${o.field} ${o.direction === "desc" ? "DESC" : "ASC"}`)
                  .join(", ")
            : `${baseTable.split(" ")[1] || baseTable}.id ASC`;

    const selectFields = [...returning, "COUNT(*) OVER() AS total_count"].join(", ");

    const query = `
        SELECT ${selectFields}
        FROM ${baseTable}
        ${joinClause}
        ${whereClause}
        ORDER BY ${orderClause}
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
    `.trim();

    values.push(limit, offset);

    return { query, values };
};

export const buildSelectByIdQuery = (table: string, id: string | number, returning: string[] = ["*"]): IQueryResult => {
    const query = `
        SELECT ${returning.join(", ")}
        FROM ${table}
        WHERE id = $1 AND deleted_at IS NULL
    `;
    const values = [id];

    return { query, values };
};

export const buildSelectByFieldQuery = (
    table: string,
    field: string,
    value: any,
    returning: string[] = ["*"],
): IQueryResult => {
    const query = `
        SELECT ${returning.join(", ")}
        FROM ${table}
        WHERE ${field} = $1 AND deleted_at IS NULL
    `;
    const values = [value];

    return { query, values };
};

export const buildFindOneQuery = (
    table: string,
    conditions: { field: string; value: unknown }[],
    returning: string[] = ["*"],
): IQueryResult => {
    const whereClauses = conditions.map((c, index) => `${c.field} = $${index + 1}`);

    const where = conditions.length > 0 ? `${whereClauses.join(" AND ")} AND deleted_at IS NULL` : "deleted_at IS NULL";

    const query = `
    SELECT ${returning.join(", ")}
    FROM ${table}
    WHERE ${where}
    LIMIT 1
  `;

    const values = conditions.map((c) => c.value);

    return { query, values };
};

export const buildUpdateQuery = (
    table: string,
    where: { field: string; value: any },
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

    const wherePlaceholder = `$${index++}`;
    values.push(where.value);

    const query = `
        UPDATE ${table}
        SET ${setClauses.join(", ")}
        WHERE ${where.field} = ${wherePlaceholder}
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
