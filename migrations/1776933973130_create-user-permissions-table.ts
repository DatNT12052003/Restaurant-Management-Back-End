import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
    pgm.createTable("user_permissions", {
        id: "id",

        user_id: {
            type: "integer",
            notNull: true,
            references: "users",
            onDelete: "CASCADE",
        },

        permission_id: {
            type: "integer",
            notNull: true,
            references: "permissions",
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

    pgm.createIndex("user_permissions", "user_id");
    pgm.createIndex("user_permissions", "permission_id");

    pgm.addConstraint(
        "user_permissions",
        "user_permissions_unique_user_permission",
        'UNIQUE("user_id", "permission_id")',
    );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropTable("user_permissions");
}
