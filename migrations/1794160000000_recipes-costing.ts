import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Giai đoạn 10: định lượng món, tự trừ kho, giá vốn và lợi nhuận.
 *
 * - `dish_ingredients`: định lượng của món (số lượng theo đơn vị của nguyên liệu, cho 1 phần). Combo lấy định lượng
 *   từ các món bên trong (theo bản chụp `order_combos.items_snapshot`).
 * - Món chuyển sang `served` thì trừ kho (giao dịch `consume`) trong cùng transaction và ghi `cost` (giá vốn theo
 *   giá bình quân lúc phục vụ) lên dòng món. `cost` NULL = món chưa có định lượng.
 * - Câu hỏi 9: cho tồn âm (không chặn bếp) -> bỏ ràng buộc `quantity >= 0` của `inventory` và `quantity_after >= 0`
 *   của sổ biến động. Phiếu xuất tay vẫn kiểm tra không vượt tồn ở service.
 * - `restaurant_closed_days`: ngày nghỉ của chi nhánh, không tính vào giờ mở cửa khi tính tỷ lệ lấp đầy bàn.
 * - Quyền `recipe.view`, `recipe.update`.
 */
const PERMISSIONS: [string, string][] = [
    ["recipe.view", "Xem định lượng và giá vốn món"],
    ["recipe.update", "Sửa định lượng món"],
];
const ROLE_PERMISSIONS: Record<string, string[]> = {
    admin: ["recipe.view", "recipe.update"],
    head_chef: ["recipe.view", "recipe.update"],
    manager: ["recipe.view"],
    sous_chef: ["recipe.view"],
};

const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`;

export async function up(pgm: MigrationBuilder): Promise<void> {
    pgm.createTable("dish_ingredients", {
        dish_id: { type: "integer", notNull: true, references: "dishes", onDelete: "CASCADE", primaryKey: true },
        ingredient_id: { type: "integer", notNull: true, references: "ingredients", onDelete: "RESTRICT", primaryKey: true },
        quantity: { type: "numeric(14,3)", notNull: true },
        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
        updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    });
    pgm.addConstraint("dish_ingredients", "dish_ingredients_quantity_check", "CHECK (quantity > 0)");
    pgm.createIndex("dish_ingredients", "ingredient_id");

    for (const table of ["order_items", "order_combos"]) {
        pgm.addColumn(table, { cost: { type: "numeric(14,2)" } });
        pgm.addConstraint(table, `${table}_cost_check`, "CHECK (cost IS NULL OR cost >= 0)");
        pgm.createIndex(table, "served_at", { where: "status = 'served'" });
    }

    // Tồn âm (câu hỏi 9)
    pgm.dropConstraint("inventory", "inventory_quantity_check");
    pgm.addConstraint("inventory", "inventory_quantity_check", "CHECK (min_quantity >= 0 AND avg_unit_cost >= 0)");
    pgm.dropConstraint("inventory_transactions", "inventory_transactions_qty_check");
    pgm.addConstraint(
        "inventory_transactions",
        "inventory_transactions_qty_check",
        "CHECK (quantity_change <> 0 AND unit_price >= 0)",
    );
    // Dòng món sinh ra giao dịch consume: order_item | order_combo (+ reference_id)
    pgm.addColumn("inventory_transactions", { reference_type: { type: "varchar(20)" } });
    pgm.createIndex("inventory_transactions", ["reference_type", "reference_id"], { where: "reference_id IS NOT NULL" });

    pgm.createTable("restaurant_closed_days", {
        restaurant_id: { type: "integer", notNull: true, references: "restaurants", onDelete: "CASCADE", primaryKey: true },
        day: { type: "date", notNull: true, primaryKey: true },
        note: { type: "varchar(255)" },
        created_by: { type: "integer", references: "users", onDelete: "SET NULL" },
        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    });
    pgm.createIndex("restaurant_closed_days", "created_by");

    pgm.sql(`
        INSERT INTO permissions (name, type_name)
        SELECT v.name, v.type_name
        FROM (VALUES ${PERMISSIONS.map(([p, n]) => `(${lit(n)}, ${lit(p)})`).join(", ")}) AS v(name, type_name)
        WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.type_name = v.type_name AND p.deleted_at IS NULL)
    `);
    const matrix = Object.entries(ROLE_PERMISSIONS)
        .flatMap(([role, perms]) => perms.map((p) => `(${lit(role)}, ${lit(p)})`))
        .join(", ");
    pgm.sql(`
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM (VALUES ${matrix}) AS m(role_type, permission_type)
        JOIN roles r ON r.type_name = m.role_type AND r.deleted_at IS NULL
        JOIN permissions p ON p.type_name = m.permission_type AND p.deleted_at IS NULL
        WHERE NOT EXISTS (
            SELECT 1 FROM role_permissions rp
            WHERE rp.role_id = r.id AND rp.permission_id = p.id AND rp.deleted_at IS NULL
        )
    `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    const list = PERMISSIONS.map(([p]) => lit(p)).join(", ");
    pgm.sql(`DELETE FROM user_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE type_name IN (${list}))`);
    pgm.sql(`DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE type_name IN (${list}))`);
    pgm.sql(`DELETE FROM permissions WHERE type_name IN (${list})`);

    pgm.dropTable("restaurant_closed_days");
    pgm.dropColumn("inventory_transactions", "reference_type");
    // Không khôi phục được ràng buộc tồn >= 0 nếu đang có tồn âm: đưa về 0 trước
    pgm.sql("UPDATE inventory SET quantity = 0 WHERE quantity < 0");
    pgm.dropConstraint("inventory_transactions", "inventory_transactions_qty_check");
    pgm.addConstraint(
        "inventory_transactions",
        "inventory_transactions_qty_check",
        "CHECK (quantity_change <> 0 AND unit_price >= 0) NOT VALID",
    );
    pgm.dropConstraint("inventory", "inventory_quantity_check");
    pgm.addConstraint("inventory", "inventory_quantity_check", "CHECK (quantity >= 0 AND min_quantity >= 0 AND avg_unit_cost >= 0)");
    for (const table of ["order_items", "order_combos"]) {
        pgm.dropIndex(table, "served_at", { ifExists: true });
        pgm.dropColumn(table, "cost");
    }
    pgm.dropTable("dish_ingredients");
}
