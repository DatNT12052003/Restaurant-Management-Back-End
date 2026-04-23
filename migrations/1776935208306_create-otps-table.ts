import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
    pgm.createType("otp_type", ["RESET_PASSWORD", "VERIFY_EMAIL", "LOGIN", "CHANGE_EMAIL", "TWO_FA"]);

    pgm.createTable("otps", {
        id: "id",

        hash_code: {
            type: "text",
            notNull: true,
        },

        type: {
            type: "otp_type",
            notNull: true,
        },

        expires_at: {
            type: "timestamp",
            notNull: true,
        },

        is_used: {
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
    pgm.createIndex("otps", "account_id");
    pgm.createIndex("otps", "expires_at");

    pgm.createIndex("otps", ["account_id", "type"], {
        name: "otps_active_idx",
        where: "is_used = false",
    });

    pgm.createIndex("otps", ["account_id", "type"], {
        name: "otps_unique_active_per_type",
        unique: true,
        where: "is_used = false",
    });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropTable("otps");
    pgm.dropType("otp_type");
}
