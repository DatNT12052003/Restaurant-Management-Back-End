import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
    pgm.createTable("tables", {
        id: "id",
        name: {
            type: "varchar(255)",
            notNull: true,
        },
        status: {
            type: "varchar(50)",
            notNull: true,
            default: "available",
        },
        room_id: {
            type: "integer",
            references: "rooms",
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

    pgm.createIndex("tables", "room_id");
    pgm.createIndex("tables", "status");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropTable("tables");
}
