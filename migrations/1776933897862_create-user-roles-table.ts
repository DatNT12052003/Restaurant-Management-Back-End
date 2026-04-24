import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
    pgm.createTable("user_roles", {
        id: "id",

        user_id: {
            type: "integer",
            notNull: true,
            references: "users",
            onDelete: "CASCADE",
        },

        role_id: {
            type: "integer",
            notNull: true,
            references: "roles",
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

    pgm.createIndex("user_roles", "user_id");
    pgm.createIndex("user_roles", "role_id");

    pgm.addConstraint("user_roles", "user_roles_unique_user_role", 'UNIQUE("user_id", "role_id")');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropTable("user_roles");
}
