import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Seed quyền thực đơn (giai đoạn 2). Chỉ thêm phần còn thiếu, giống migration seed giai đoạn 0.
 * Giá trị được viết cứng (không import enum) để migration không đổi nghĩa nếu enum thay đổi sau này.
 */
const PERMISSIONS: [string, string][] = [
    ["dish.create", "Tạo món ăn"],
    ["dish.view", "Xem món ăn"],
    ["dish.update", "Cập nhật món ăn"],
    ["dish.delete", "Xóa món ăn"],
    ["dish.availability", "Bật/tắt món và giá theo nhà hàng"],
    ["combo.create", "Tạo combo"],
    ["combo.view", "Xem combo"],
    ["combo.update", "Cập nhật combo"],
    ["combo.delete", "Xóa combo"],
];

const ALL = PERMISSIONS.map(([p]) => p);
const VIEW = ["dish.view", "combo.view"];

const ROLE_PERMISSIONS: Record<string, string[]> = {
    admin: ALL,
    // Bếp trưởng xây dựng thực đơn (đặc tả 2.3)
    head_chef: ALL,
    manager: [...VIEW, "dish.availability"],
    supervisor: [...VIEW, "dish.availability"],
    sous_chef: [...VIEW, "dish.availability"],
    cashier: VIEW,
    receptionist: VIEW,
    waitstaff: VIEW,
    barista: VIEW,
    commis_chef: VIEW,
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
    pgm.sql(`
        DELETE FROM role_permissions WHERE permission_id IN (
            SELECT id FROM permissions WHERE type_name IN (${ALL.map(lit).join(", ")})
        )
    `);
    pgm.sql(`DELETE FROM permissions WHERE type_name IN (${ALL.map(lit).join(", ")})`);
}
