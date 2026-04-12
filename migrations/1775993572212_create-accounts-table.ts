import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
    pgm.createTable("accounts", {
        id: "id",
        username: {
            type: "varchar(100)",
            notNull: true,
            unique: true,
        },
        hash_password: {
            type: "text",
            notNull: true,
        },
        created_at: {
            type: "timestamp",
            default: pgm.func("now()"),
        },
        updated_at: {
            type: "timestamp",
            default: pgm.func("now()"),
        },
        deleted_at: {
            type: "timestamp",
        },
    });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropTable("accounts");
}
