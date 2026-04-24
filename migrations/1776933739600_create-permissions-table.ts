import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
    pgm.createTable("permissions", {
        id: "id",

        name: {
            type: "varchar(255)",
            notNull: true,
        },

        type_name: {
            type: "varchar(100)",
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

    pgm.createIndex("permissions", "name");
    pgm.createIndex("permissions", "type_name");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropTable("permissions");
}
