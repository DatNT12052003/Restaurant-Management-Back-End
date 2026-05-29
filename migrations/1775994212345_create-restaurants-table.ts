import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
    pgm.createTable("restaurants", {
        id: "id",
        name: {
            type: "varchar(255)",
            notNull: true,
        },
        status: {
            type: "varchar(20)",
            notNull: true,
            default: "unblocked",
        },
        address: {
            type: "text",
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

    pgm.createIndex("restaurants", "name");
    pgm.createIndex("restaurants", "status");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropTable("restaurants");
}
