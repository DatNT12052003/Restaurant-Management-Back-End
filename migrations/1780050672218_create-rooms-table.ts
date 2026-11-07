import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
    pgm.createTable("rooms", {
        id: "id",
        name: {
            type: "varchar(255)",
            notNull: true,
        },
        type: {
            type: "varchar(50)",
            notNull: true,
            default: "public",
        },
        description: {
            type: "text",
        },
        status: {
            type: "varchar(50)",
            notNull: true,
            default: "available",
        },
        restaurant_id: {
            type: "integer",
            references: "restaurants",
            onDelete: "CASCADE",
            notNull: true,
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

    pgm.createIndex("rooms", "restaurant_id");
    pgm.createIndex("rooms", "status");
    pgm.createIndex("rooms", "type");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropTable("rooms");
}
