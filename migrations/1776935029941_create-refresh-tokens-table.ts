import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
    pgm.createTable("refresh_tokens", {
        id: "id",

        hash_token: {
            type: "text",
            notNull: true,
            unique: true,
        },

        expires_at: {
            type: "timestamp",
            notNull: true,
        },

        revoked: {
            type: "boolean",
            notNull: true,
            default: false,
        },

        account_id: {
            type: "integer",
            notNull: true,
            references: "accounts",
            onDelete: "CASCADE",
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

    pgm.createIndex("refresh_tokens", "account_id");
    pgm.createIndex("refresh_tokens", "expires_at");

    pgm.createIndex("refresh_tokens", "hash_token", {
        name: "refresh_tokens_active_hash_idx",
        where: "revoked = false",
    });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropTable("refresh_tokens");
}
