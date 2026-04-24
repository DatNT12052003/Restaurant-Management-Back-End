import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
    pgm.createTable("roles", {
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

    pgm.createIndex("roles", "name");
    pgm.createIndex("roles", "type_name");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropTable("roles");
}
