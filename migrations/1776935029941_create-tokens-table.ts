import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
    pgm.createTable("tokens", {
        id: "id",

        jti: {
            type: "uuid",
            notNull: true,
            unique: true,
        },

        hash_token: {
            type: "text",
            notNull: true,
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

        type: {
            type: "varchar(255)",
            notNull: true,
            default: "REFRESH",
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

    pgm.createIndex("tokens", "account_id");
    pgm.createIndex("tokens", "expires_at");

    pgm.createIndex("tokens", "hash_token", {
        name: "tokens_active_hash_idx",
        where: "revoked = false",
    });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropTable("tokens");
}
