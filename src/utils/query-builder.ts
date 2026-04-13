export const buildInsertQuery = (
    table: string,
    payload: Record<string, any>,
    allowedFields: string[],
    returning: string[] = ["*"],
) => {
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
