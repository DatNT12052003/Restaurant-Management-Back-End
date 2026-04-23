import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
    pgm.createTable("role_permissions", {
        id: "id",

        role_id: {
            type: "integer",
            notNull: true,
            references: "roles",
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

    pgm.createIndex("role_permissions", "role_id");
    pgm.createIndex("role_permissions", "permission_id");

    pgm.addConstraint(
        "role_permissions",
        "role_permissions_unique_role_permission",
        'UNIQUE("role_id", "permission_id")',
    );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropTable("role_permissions");
}
