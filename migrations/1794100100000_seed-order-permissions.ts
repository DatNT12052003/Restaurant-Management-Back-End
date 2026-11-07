import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Seed quyền order (giai đoạn 4). Chỉ thêm phần còn thiếu, giống các migration seed trước.
 * Giá trị được viết cứng (không import enum) để migration không đổi nghĩa nếu enum thay đổi sau này.
 */
const PERMISSIONS: [string, string][] = [
    ["order.create", "Mở order"],
    ["order.view", "Xem order"],
    ["order.update", "Cập nhật order, gọi món, chuyển bàn"],
    ["order.cancel", "Hủy order và hủy món đã chế biến"],
    ["order_item.prepare", "Xác nhận và chế biến món"],
    ["order_item.serve", "Phục vụ món"],
];

const ALL = PERMISSIONS.map(([p]) => p);
const FLOOR = ["order.create", "order.view", "order.update", "order_item.serve"];
const KITCHEN = ["order.view", "order_item.prepare"];

const ROLE_PERMISSIONS: Record<string, string[]> = {
    admin: ALL,
    manager: ALL,
    supervisor: ALL,
    waitstaff: FLOOR,
    // Lễ tân mở order khi đón khách
    receptionist: ["order.create", "order.view"],
    // Thu ngân xem order để thanh toán (giai đoạn 5)
    cashier: ["order.view"],
    head_chef: KITCHEN,
    sous_chef: KITCHEN,
    commis_chef: KITCHEN,
    barista: KITCHEN,
};

const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`;

export async function up(pgm: MigrationBuilder): Promise<void> {
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
}
