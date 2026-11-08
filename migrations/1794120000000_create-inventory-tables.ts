import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Giai đoạn 6 — kho nguyên liệu (đặc tả 4.5, 8.6).
 *
 * - `ingredients`: danh mục nguyên liệu dùng chung cả chuỗi (giống thực đơn).
 * - `inventory`: tồn kho từng nguyên liệu tại từng nhà hàng, kèm giá vốn bình quân (cập nhật khi nhập).
 * - `inventory_receipts`: phiếu nhập / xuất / kiểm kê (một phiếu nhiều dòng). Phiếu không sửa, không xóa;
 *   muốn đính chính thì lập phiếu kiểm kê.
 * - `inventory_transactions`: sổ biến động (chỉ thêm). Mọi thay đổi `inventory.quantity` đều đi kèm một dòng ở đây,
 *   trong cùng transaction (đặc tả 8.6). `consume` dành cho tự trừ kho theo định lượng món (chưa làm).
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
    pgm.createTable("ingredients", {
        id: "id",
        name: { type: "varchar(255)", notNull: true },
        unit: { type: "varchar(20)", notNull: true },
        description: { type: "text" },
        status: { type: "varchar(10)", notNull: true, default: "active" },
        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
        updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
        deleted_at: { type: "timestamptz" },
    });
    pgm.addConstraint("ingredients", "ingredients_status_check", "CHECK (status IN ('active', 'inactive'))");
    pgm.sql("CREATE UNIQUE INDEX ingredients_name_unique ON ingredients (lower(name)) WHERE deleted_at IS NULL");

    pgm.createTable("inventory", {
        restaurant_id: { type: "integer", notNull: true, references: "restaurants", onDelete: "CASCADE", primaryKey: true },
        ingredient_id: { type: "integer", notNull: true, references: "ingredients", onDelete: "RESTRICT", primaryKey: true },
        quantity: { type: "numeric(14,3)", notNull: true, default: 0 },
        // Ngưỡng cảnh báo tồn thấp; 0 = không cảnh báo
        min_quantity: { type: "numeric(14,3)", notNull: true, default: 0 },
        // Giá vốn bình quân gia quyền / 1 đơn vị (cập nhật khi nhập)
        avg_unit_cost: { type: "numeric(14,2)", notNull: true, default: 0 },
        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
        updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    });
    pgm.addConstraint(
        "inventory",
        "inventory_quantity_check",
        "CHECK (quantity >= 0 AND min_quantity >= 0 AND avg_unit_cost >= 0)",
    );
    pgm.createIndex("inventory", "ingredient_id");

    pgm.createTable("inventory_receipts", {
        id: "id",
        // Ví dụ NK-R1-20261108-001
        code: { type: "varchar(40)", notNull: true, unique: true },
        restaurant_id: { type: "integer", notNull: true, references: "restaurants", onDelete: "RESTRICT" },
        type: { type: "varchar(10)", notNull: true },
        // Nhà cung cấp (phiếu nhập)
        supplier: { type: "varchar(255)" },
        // Lý do (bắt buộc với phiếu xuất / kiểm kê)
        reason: { type: "text" },
        note: { type: "text" },
        // Tổng giá trị: nhập = Σ số lượng × đơn giá; xuất / kiểm kê = theo giá vốn bình quân
        total_value: { type: "numeric(14,2)", notNull: true, default: 0 },
        created_by: { type: "integer", references: "users", onDelete: "SET NULL" },
        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    });
    pgm.addConstraint("inventory_receipts", "inventory_receipts_type_check", "CHECK (type IN ('import', 'export', 'adjust'))");
    pgm.createIndex("inventory_receipts", ["restaurant_id", "created_at"]);
    pgm.createIndex("inventory_receipts", "type");
    pgm.createIndex("inventory_receipts", "created_by");

    pgm.createTable("inventory_transactions", {
        id: { type: "bigserial", primaryKey: true },
        restaurant_id: { type: "integer", notNull: true, references: "restaurants", onDelete: "RESTRICT" },
        ingredient_id: { type: "integer", notNull: true, references: "ingredients", onDelete: "RESTRICT" },
        receipt_id: { type: "integer", references: "inventory_receipts", onDelete: "RESTRICT" },
        type: { type: "varchar(10)", notNull: true },
        // Dương = tăng, âm = giảm
        quantity_change: { type: "numeric(14,3)", notNull: true },
        quantity_after: { type: "numeric(14,3)", notNull: true },
        // Nhập: đơn giá nhập; xuất / kiểm kê: giá vốn bình quân tại thời điểm đó
        unit_price: { type: "numeric(14,2)", notNull: true, default: 0 },
        reason: { type: "text" },
        // Liên kết khác (ví dụ dòng món khi tự trừ kho)
        reference_id: { type: "integer" },
        created_by: { type: "integer", references: "users", onDelete: "SET NULL" },
        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    });
    pgm.addConstraint(
        "inventory_transactions",
        "inventory_transactions_type_check",
        "CHECK (type IN ('import', 'export', 'adjust', 'consume'))",
    );
    pgm.addConstraint(
        "inventory_transactions",
        "inventory_transactions_qty_check",
        "CHECK (quantity_change <> 0 AND quantity_after >= 0 AND unit_price >= 0)",
    );
    pgm.createIndex("inventory_transactions", ["restaurant_id", "ingredient_id", "created_at"]);
    pgm.createIndex("inventory_transactions", "receipt_id");
    pgm.createIndex("inventory_transactions", ["restaurant_id", "created_at"]);
    pgm.createIndex("inventory_transactions", "created_by");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropTable("inventory_transactions");
    pgm.dropTable("inventory_receipts");
    pgm.dropTable("inventory");
    pgm.dropTable("ingredients");
}
