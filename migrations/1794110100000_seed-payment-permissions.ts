import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Seed quyền thanh toán và khuyến mãi (giai đoạn 5). Chỉ thêm phần còn thiếu, giống các migration seed trước.
 * Giá trị được viết cứng (không import enum) để migration không đổi nghĩa nếu enum thay đổi sau này.
 */
const PERMISSIONS: [string, string][] = [
    ["payment.view", "Xem thanh toán"],
    ["payment.create", "Thu tiền"],
    ["payment.refund", "Hoàn tiền"],
    ["discount.view", "Xem mã giảm giá"],
    ["discount.create", "Tạo mã giảm giá"],
    ["discount.update", "Cập nhật mã giảm giá"],
    ["discount.delete", "Xóa mã giảm giá"],
    ["discount.apply", "Áp mã giảm giá cho order"],
];

const ALL = PERMISSIONS.map(([p]) => p);
const CHECKOUT = ["payment.view", "payment.create", "discount.view", "discount.apply"];

const ROLE_PERMISSIONS: Record<string, string[]> = {
    admin: ALL,
    manager: ALL,
    supervisor: CHECKOUT,
    cashier: CHECKOUT,
    // Phục vụ xem được đã thanh toán chưa
    waitstaff: ["payment.view"],
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
