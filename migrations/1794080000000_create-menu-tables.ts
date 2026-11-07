import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

const timestamps = (pgm: MigrationBuilder, softDelete = true) => ({
    created_at: { type: "timestamp", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamp", notNull: true, default: pgm.func("now()") },
    ...(softDelete ? { deleted_at: { type: "timestamp" } } : {}),
});

/**
 * Giai đoạn 2 — thực đơn (đặc tả 4.4) và hình ảnh (4.10).
 *
 * Thực đơn dùng chung cho cả chuỗi (`dishes`, `combos`). Mỗi nhà hàng có thể tắt món / đặt giá riêng qua
 * `restaurant_dishes` / `restaurant_combos`; không có dòng nào nghĩa là đang bán với giá gốc.
 *
 * Bảng nối (`dish_tags`, `combo_items`, `restaurant_*`) xóa cứng: chúng không có lịch sử cần giữ,
 * còn giá lịch sử của món bán ra sẽ được lưu ở `order_items.current_price` (giai đoạn 4).
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
    // ---- Món ăn ----
    pgm.createTable("dishes", {
        id: "id",
        name: { type: "varchar(255)", notNull: true },
        description: { type: "text" },
        price: { type: "numeric(12,2)", notNull: true },
        // food: chuyển cho bếp; drink: chuyển cho quầy pha chế (giai đoạn 4)
        category: { type: "varchar(20)", notNull: true, default: "food" },
        status: { type: "varchar(20)", notNull: true, default: "active" },
        ...timestamps(pgm),
    });
    pgm.addConstraint("dishes", "dishes_price_check", "CHECK (price >= 0)");
    pgm.addConstraint("dishes", "dishes_category_check", "CHECK (category IN ('food', 'drink'))");
    pgm.addConstraint("dishes", "dishes_status_check", "CHECK (status IN ('active', 'discontinued'))");
    // Tên không trùng (không phân biệt hoa thường) giữa các bản ghi chưa xóa
    pgm.sql("CREATE UNIQUE INDEX dishes_name_unique ON dishes (lower(name)) WHERE deleted_at IS NULL");
    pgm.createIndex("dishes", ["status", "category"]);

    // ---- Thẻ ----
    pgm.createTable("tags", {
        id: "id",
        name: { type: "varchar(100)", notNull: true },
        ...timestamps(pgm),
    });
    // Tên không trùng (không phân biệt hoa thường) giữa các bản ghi chưa xóa
    pgm.sql("CREATE UNIQUE INDEX tags_name_unique ON tags (lower(name)) WHERE deleted_at IS NULL");

    pgm.createTable("dish_tags", {
        dish_id: { type: "integer", notNull: true, references: "dishes", onDelete: "CASCADE", primaryKey: true },
        tag_id: { type: "integer", notNull: true, references: "tags", onDelete: "CASCADE", primaryKey: true },
        created_at: { type: "timestamp", notNull: true, default: pgm.func("now()") },
    });
    pgm.createIndex("dish_tags", "tag_id");

    // ---- Combo ----
    pgm.createTable("combos", {
        id: "id",
        name: { type: "varchar(255)", notNull: true },
        description: { type: "text" },
        price: { type: "numeric(12,2)", notNull: true },
        status: { type: "varchar(20)", notNull: true, default: "active" },
        ...timestamps(pgm),
    });
    pgm.addConstraint("combos", "combos_price_check", "CHECK (price >= 0)");
    pgm.addConstraint("combos", "combos_status_check", "CHECK (status IN ('active', 'discontinued'))");
    // Tên không trùng (không phân biệt hoa thường) giữa các bản ghi chưa xóa
    pgm.sql("CREATE UNIQUE INDEX combos_name_unique ON combos (lower(name)) WHERE deleted_at IS NULL");

    pgm.createTable("combo_items", {
        combo_id: { type: "integer", notNull: true, references: "combos", onDelete: "CASCADE", primaryKey: true },
        dish_id: { type: "integer", notNull: true, references: "dishes", onDelete: "RESTRICT", primaryKey: true },
        quantity: { type: "integer", notNull: true, default: 1 },
    });
    pgm.addConstraint("combo_items", "combo_items_quantity_check", "CHECK (quantity > 0)");
    pgm.createIndex("combo_items", "dish_id");

    // ---- Tùy chỉnh theo nhà hàng ----
    for (const [table, ref, col] of [
        ["restaurant_dishes", "dishes", "dish_id"],
        ["restaurant_combos", "combos", "combo_id"],
    ] as const) {
        pgm.createTable(table, {
            restaurant_id: { type: "integer", notNull: true, references: "restaurants", onDelete: "CASCADE", primaryKey: true },
            [col]: { type: "integer", notNull: true, references: ref, onDelete: "CASCADE", primaryKey: true },
            is_available: { type: "boolean", notNull: true, default: true },
            // null = dùng giá gốc
            price: { type: "numeric(12,2)" },
            ...timestamps(pgm, false),
        });
        pgm.addConstraint(table, `${table}_price_check`, "CHECK (price IS NULL OR price >= 0)");
        pgm.createIndex(table, col);
    }

    // ---- Hình ảnh ----
    pgm.createTable("images", {
        id: "id",
        url: { type: "text", notNull: true },
        // public_id của Cloudinary, dùng để xóa file
        public_id: { type: "text" },
        entity_type: { type: "varchar(20)", notNull: true },
        entity_id: { type: "integer", notNull: true },
        is_primary: { type: "boolean", notNull: true, default: false },
        sort_order: { type: "integer", notNull: true, default: 0 },
        ...timestamps(pgm),
    });
    pgm.addConstraint(
        "images",
        "images_entity_type_check",
        "CHECK (entity_type IN ('restaurant', 'room', 'dish', 'combo'))",
    );
    pgm.createIndex("images", ["entity_type", "entity_id"], { where: "deleted_at IS NULL" });
    // Mỗi đối tượng có tối đa một ảnh đại diện
    pgm.createIndex("images", ["entity_type", "entity_id"], {
        name: "images_one_primary",
        unique: true,
        where: "is_primary AND deleted_at IS NULL",
    });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropTable("images");
    pgm.dropTable("restaurant_combos");
    pgm.dropTable("restaurant_dishes");
    pgm.dropTable("combo_items");
    pgm.dropTable("combos");
    pgm.dropTable("dish_tags");
    pgm.dropTable("tags");
    pgm.dropTable("dishes");
}
