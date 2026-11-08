import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Giai đoạn 11: nhà cung cấp, đơn đặt hàng, lô hàng / hạn dùng, chuyển kho, công nợ nhà cung cấp.
 *
 * - `suppliers`, `supplier_ingredients` (bảng giá): danh mục dùng chung cả chuỗi.
 * - `purchase_orders` / `purchase_order_lines`: nháp -> đã gửi -> nhận một phần -> đã nhận đủ (hoặc đã đóng / đã hủy).
 *   Mỗi lần nhận hàng tạo một phiếu nhập kho (`inventory_receipts.purchase_order_id`) và một khoản phải trả.
 * - Lô hàng (câu hỏi 9): `ingredients.track_expiry` bật theo nguyên liệu. `inventory_lots` lưu số lượng còn lại theo
 *   hạn dùng; mọi lần trừ kho trừ lô hết hạn sớm nhất trước (FEFO). Giá vốn vẫn theo bình quân gia quyền.
 * - Phiếu hủy hàng (`dispose`) cho hàng hết hạn / hỏng.
 * - `stock_transfers`: trừ kho chi nhánh gửi khi xuất phiếu (đang chuyển), cộng kho chi nhánh nhận khi xác nhận;
 *   phần thiếu khi nhận ghi là hao hụt vận chuyển.
 * - `supplier_bills` / `supplier_payments`: công nợ nhà cung cấp (mỗi lần nhận hàng theo đơn một khoản phải trả).
 */
const PERMISSIONS: [string, string][] = [
    ["supplier.view", "Xem nhà cung cấp và bảng giá"],
    ["supplier.manage", "Thêm, sửa, xóa nhà cung cấp và bảng giá"],
    ["purchase.view", "Xem đơn đặt hàng nguyên liệu"],
    ["purchase.create", "Lập, gửi, hủy đơn đặt hàng nguyên liệu"],
    ["purchase.receive", "Nhận hàng theo đơn đặt hàng"],
    ["inventory.transfer", "Chuyển kho giữa các chi nhánh"],
    ["inventory.dispose", "Hủy hàng hết hạn / hỏng"],
    ["payable.view", "Xem công nợ nhà cung cấp"],
    ["payable.pay", "Ghi nhận thanh toán cho nhà cung cấp"],
];
const ALL = PERMISSIONS.map(([p]) => p);
const ROLE_PERMISSIONS: Record<string, string[]> = {
    admin: ALL,
    manager: ALL,
    head_chef: ["supplier.view", "purchase.view", "purchase.create", "purchase.receive", "inventory.transfer", "inventory.dispose"],
    sous_chef: ["supplier.view", "purchase.view", "purchase.receive", "inventory.dispose"],
    supervisor: ["supplier.view", "purchase.view"],
};

const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`;

export async function up(pgm: MigrationBuilder): Promise<void> {
    const stamps = {
        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
        updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    };

    // ---- Nhà cung cấp ----
    pgm.createTable("suppliers", {
        id: "id",
        name: { type: "varchar(255)", notNull: true },
        contact_name: { type: "varchar(255)" },
        phone: { type: "varchar(30)" },
        email: { type: "varchar(255)" },
        address: { type: "text" },
        tax_code: { type: "varchar(30)" },
        // Số ngày được trả chậm kể từ ngày nhận hàng (0 = trả ngay)
        payment_terms_days: { type: "integer", notNull: true, default: 0 },
        note: { type: "text" },
        status: { type: "varchar(10)", notNull: true, default: "active" },
        ...stamps,
        deleted_at: { type: "timestamptz" },
    });
    pgm.addConstraint("suppliers", "suppliers_status_check", "CHECK (status IN ('active', 'inactive'))");
    pgm.addConstraint("suppliers", "suppliers_terms_check", "CHECK (payment_terms_days BETWEEN 0 AND 365)");
    pgm.sql("CREATE UNIQUE INDEX suppliers_name_unique ON suppliers (lower(name)) WHERE deleted_at IS NULL");

    pgm.createTable("supplier_ingredients", {
        supplier_id: { type: "integer", notNull: true, references: "suppliers", onDelete: "CASCADE", primaryKey: true },
        ingredient_id: { type: "integer", notNull: true, references: "ingredients", onDelete: "CASCADE", primaryKey: true },
        unit_price: { type: "numeric(14,2)", notNull: true },
        is_preferred: { type: "boolean", notNull: true, default: false },
        ...stamps,
    });
    pgm.addConstraint("supplier_ingredients", "supplier_ingredients_price_check", "CHECK (unit_price >= 0)");
    pgm.createIndex("supplier_ingredients", "ingredient_id");

    // ---- Lô hàng ----
    pgm.addColumns("ingredients", {
        track_expiry: { type: "boolean", notNull: true, default: false },
        // Gợi ý hạn dùng khi nhập (số ngày kể từ ngày nhập)
        shelf_life_days: { type: "integer" },
    });
    pgm.addConstraint("ingredients", "ingredients_shelf_life_check", "CHECK (shelf_life_days IS NULL OR shelf_life_days BETWEEN 1 AND 3650)");

    // ---- Đơn đặt hàng ----
    pgm.createTable("purchase_orders", {
        id: "id",
        code: { type: "varchar(40)", notNull: true, unique: true },
        restaurant_id: { type: "integer", notNull: true, references: "restaurants", onDelete: "RESTRICT" },
        supplier_id: { type: "integer", notNull: true, references: "suppliers", onDelete: "RESTRICT" },
        status: { type: "varchar(12)", notNull: true, default: "draft" },
        expected_date: { type: "date" },
        note: { type: "text" },
        total: { type: "numeric(14,2)", notNull: true, default: 0 },
        created_by: { type: "integer", references: "users", onDelete: "SET NULL" },
        sent_at: { type: "timestamptz" },
        closed_at: { type: "timestamptz" },
        cancel_reason: { type: "text" },
        ...stamps,
    });
    pgm.addConstraint(
        "purchase_orders",
        "purchase_orders_status_check",
        "CHECK (status IN ('draft', 'sent', 'partial', 'received', 'closed', 'cancelled'))",
    );
    pgm.createIndex("purchase_orders", ["restaurant_id", "created_at"]);
    pgm.createIndex("purchase_orders", "supplier_id");
    pgm.createIndex("purchase_orders", "status");
    pgm.createIndex("purchase_orders", "created_by");

    pgm.createTable("purchase_order_lines", {
        id: "id",
        purchase_order_id: { type: "integer", notNull: true, references: "purchase_orders", onDelete: "CASCADE" },
        ingredient_id: { type: "integer", notNull: true, references: "ingredients", onDelete: "RESTRICT" },
        quantity: { type: "numeric(14,3)", notNull: true },
        unit_price: { type: "numeric(14,2)", notNull: true },
        received_quantity: { type: "numeric(14,3)", notNull: true, default: 0 },
    });
    pgm.addConstraint(
        "purchase_order_lines",
        "purchase_order_lines_check",
        "CHECK (quantity > 0 AND unit_price >= 0 AND received_quantity >= 0)",
    );
    pgm.addConstraint("purchase_order_lines", "purchase_order_lines_unique", "UNIQUE (purchase_order_id, ingredient_id)");
    pgm.createIndex("purchase_order_lines", "ingredient_id");

    // ---- Chuyển kho ----
    pgm.createTable("stock_transfers", {
        id: "id",
        code: { type: "varchar(40)", notNull: true, unique: true },
        from_restaurant_id: { type: "integer", notNull: true, references: "restaurants", onDelete: "RESTRICT" },
        to_restaurant_id: { type: "integer", notNull: true, references: "restaurants", onDelete: "RESTRICT" },
        status: { type: "varchar(12)", notNull: true, default: "in_transit" },
        note: { type: "text" },
        total_value: { type: "numeric(14,2)", notNull: true, default: 0 },
        /** Giá trị hàng thiếu khi nhận (hao hụt vận chuyển) */
        loss_value: { type: "numeric(14,2)", notNull: true, default: 0 },
        created_by: { type: "integer", references: "users", onDelete: "SET NULL" },
        received_by: { type: "integer", references: "users", onDelete: "SET NULL" },
        received_at: { type: "timestamptz" },
        cancelled_at: { type: "timestamptz" },
        ...stamps,
    });
    pgm.addConstraint("stock_transfers", "stock_transfers_status_check", "CHECK (status IN ('in_transit', 'received', 'cancelled'))");
    pgm.addConstraint("stock_transfers", "stock_transfers_branches_check", "CHECK (from_restaurant_id <> to_restaurant_id)");
    pgm.createIndex("stock_transfers", ["from_restaurant_id", "created_at"]);
    pgm.createIndex("stock_transfers", ["to_restaurant_id", "created_at"]);
    pgm.createIndex("stock_transfers", "status");
    pgm.createIndex("stock_transfers", "created_by");
    pgm.createIndex("stock_transfers", "received_by");

    pgm.createTable("stock_transfer_lines", {
        id: "id",
        transfer_id: { type: "integer", notNull: true, references: "stock_transfers", onDelete: "CASCADE" },
        ingredient_id: { type: "integer", notNull: true, references: "ingredients", onDelete: "RESTRICT" },
        quantity: { type: "numeric(14,3)", notNull: true },
        /** Giá vốn bình quân của chi nhánh gửi lúc xuất */
        unit_cost: { type: "numeric(14,2)", notNull: true },
        received_quantity: { type: "numeric(14,3)" },
        /** Các lô đã lấy ở chi nhánh gửi: [{ lot_code, expiry_date, quantity }] (để tạo lại lô ở chi nhánh nhận) */
        lots: { type: "jsonb", notNull: true, default: pgm.func("'[]'::jsonb") },
    });
    pgm.addConstraint(
        "stock_transfer_lines",
        "stock_transfer_lines_check",
        "CHECK (quantity > 0 AND unit_cost >= 0 AND (received_quantity IS NULL OR received_quantity >= 0))",
    );
    pgm.addConstraint("stock_transfer_lines", "stock_transfer_lines_unique", "UNIQUE (transfer_id, ingredient_id)");
    pgm.createIndex("stock_transfer_lines", "ingredient_id");

    // ---- Phiếu kho: hủy hàng, liên kết đơn đặt hàng / nhà cung cấp ----
    pgm.dropConstraint("inventory_receipts", "inventory_receipts_type_check");
    pgm.addConstraint("inventory_receipts", "inventory_receipts_type_check", "CHECK (type IN ('import', 'export', 'adjust', 'dispose'))");
    pgm.addColumns("inventory_receipts", {
        supplier_id: { type: "integer", references: "suppliers", onDelete: "SET NULL" },
        purchase_order_id: { type: "integer", references: "purchase_orders", onDelete: "SET NULL" },
    });
    pgm.createIndex("inventory_receipts", "supplier_id");
    pgm.createIndex("inventory_receipts", "purchase_order_id");

    // "transfer_out" dài 12 ký tự: mở rộng cột loại giao dịch
    pgm.alterColumn("inventory_transactions", "type", { type: "varchar(20)" });
    pgm.dropConstraint("inventory_transactions", "inventory_transactions_type_check");
    pgm.addConstraint(
        "inventory_transactions",
        "inventory_transactions_type_check",
        "CHECK (type IN ('import', 'export', 'adjust', 'consume', 'dispose', 'transfer_out', 'transfer_in'))",
    );

    pgm.createTable("inventory_lots", {
        id: "id",
        restaurant_id: { type: "integer", notNull: true, references: "restaurants", onDelete: "RESTRICT" },
        ingredient_id: { type: "integer", notNull: true, references: "ingredients", onDelete: "RESTRICT" },
        lot_code: { type: "varchar(60)" },
        expiry_date: { type: "date", notNull: true },
        initial_quantity: { type: "numeric(14,3)", notNull: true },
        /** Số lượng còn lại của lô */
        quantity: { type: "numeric(14,3)", notNull: true },
        receipt_id: { type: "integer", references: "inventory_receipts", onDelete: "SET NULL" },
        transfer_id: { type: "integer", references: "stock_transfers", onDelete: "SET NULL" },
        ...stamps,
    });
    pgm.addConstraint("inventory_lots", "inventory_lots_quantity_check", "CHECK (quantity >= 0 AND initial_quantity > 0)");
    // FEFO: tìm lô còn hàng theo hạn dùng
    pgm.createIndex("inventory_lots", ["restaurant_id", "ingredient_id", "expiry_date"], { where: "quantity > 0" });
    pgm.createIndex("inventory_lots", "ingredient_id");
    pgm.createIndex("inventory_lots", "receipt_id");
    pgm.createIndex("inventory_lots", "transfer_id");

    // ---- Công nợ nhà cung cấp ----
    pgm.createTable("supplier_bills", {
        id: "id",
        supplier_id: { type: "integer", notNull: true, references: "suppliers", onDelete: "RESTRICT" },
        restaurant_id: { type: "integer", notNull: true, references: "restaurants", onDelete: "RESTRICT" },
        purchase_order_id: { type: "integer", references: "purchase_orders", onDelete: "SET NULL" },
        receipt_id: { type: "integer", notNull: true, references: "inventory_receipts", onDelete: "RESTRICT", unique: true },
        amount: { type: "numeric(14,2)", notNull: true },
        paid_amount: { type: "numeric(14,2)", notNull: true, default: 0 },
        due_date: { type: "date", notNull: true },
        status: { type: "varchar(10)", notNull: true, default: "unpaid" },
        ...stamps,
    });
    pgm.addConstraint("supplier_bills", "supplier_bills_status_check", "CHECK (status IN ('unpaid', 'partial', 'paid'))");
    pgm.addConstraint("supplier_bills", "supplier_bills_amount_check", "CHECK (amount >= 0 AND paid_amount >= 0 AND paid_amount <= amount)");
    pgm.createIndex("supplier_bills", ["restaurant_id", "due_date"]);
    pgm.createIndex("supplier_bills", "supplier_id");
    pgm.createIndex("supplier_bills", "purchase_order_id");
    pgm.createIndex("supplier_bills", "status");

    pgm.createTable("supplier_payments", {
        id: "id",
        bill_id: { type: "integer", notNull: true, references: "supplier_bills", onDelete: "RESTRICT" },
        amount: { type: "numeric(14,2)", notNull: true },
        method: { type: "varchar(10)", notNull: true },
        reference: { type: "varchar(100)" },
        note: { type: "text" },
        paid_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
        created_by: { type: "integer", references: "users", onDelete: "SET NULL" },
        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    });
    pgm.addConstraint("supplier_payments", "supplier_payments_check", "CHECK (amount > 0 AND method IN ('cash', 'card', 'transfer'))");
    pgm.createIndex("supplier_payments", "bill_id");
    pgm.createIndex("supplier_payments", "created_by");

    // ---- Quyền ----
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
    const list = ALL.map(lit).join(", ");
    pgm.sql(`DELETE FROM user_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE type_name IN (${list}))`);
    pgm.sql(`DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE type_name IN (${list}))`);
    pgm.sql(`DELETE FROM permissions WHERE type_name IN (${list})`);

    pgm.dropTable("supplier_payments");
    pgm.dropTable("supplier_bills");
    pgm.dropTable("inventory_lots");
    pgm.sql("DELETE FROM inventory_transactions WHERE type IN ('dispose', 'transfer_out', 'transfer_in')");
    pgm.dropConstraint("inventory_transactions", "inventory_transactions_type_check");
    pgm.addConstraint(
        "inventory_transactions",
        "inventory_transactions_type_check",
        "CHECK (type IN ('import', 'export', 'adjust', 'consume'))",
    );
    pgm.dropColumns("inventory_receipts", ["supplier_id", "purchase_order_id"]);
    pgm.sql("DELETE FROM inventory_receipts WHERE type = 'dispose'");
    pgm.dropConstraint("inventory_receipts", "inventory_receipts_type_check");
    pgm.addConstraint("inventory_receipts", "inventory_receipts_type_check", "CHECK (type IN ('import', 'export', 'adjust'))");
    pgm.dropTable("stock_transfer_lines");
    pgm.dropTable("stock_transfers");
    pgm.dropTable("purchase_order_lines");
    pgm.dropTable("purchase_orders");
    pgm.dropConstraint("ingredients", "ingredients_shelf_life_check");
    pgm.dropColumns("ingredients", ["track_expiry", "shelf_life_days"]);
    pgm.dropTable("supplier_ingredients");
    pgm.dropTable("suppliers");
}
