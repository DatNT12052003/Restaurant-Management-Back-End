import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
    pgm.createTable("guests", {
        id: "id",

        full_name: {
            type: "varchar(255)",
            notNull: true,
        },

        gender: {
            type: "varchar(10)",
        },

        phone_number: {
            type: "varchar(20)",
        },

        email: {
            type: "varchar(255)",
            unique: true,
        },

        address: {
            type: "text",
        },

        status: {
            type: "varchar(20)",
            notNull: true,
            default: "new",
        },

        account_id: {
            type: "integer",
            references: "accounts",
            onDelete: "SET NULL",
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

    pgm.createIndex("guests", "phone_number");
    pgm.createIndex("guests", "email");
    pgm.createIndex("guests", "account_id");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropTable("guests");
}
