import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
    pgm.createTable("users", {
        id: "id",
        full_name: {
            type: "varchar(255)",
            notNull: true,
        },
        date_of_birth: {
            type: "date",
        },
        gender: {
            type: "varchar(10)",
        },
        address: {
            type: "text",
        },
        email: {
            type: "varchar(255)",
            unique: true,
        },
        phone_number: {
            type: "varchar(20)",
            unique: true,
        },
        avatar_url: {
            type: "text",
        },
        status: {
            type: "varchar(20)",
            notNull: true,
            default: "active",
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

    pgm.createIndex("users", "account_id");
    pgm.createIndex("users", "email");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropTable("users");
}
