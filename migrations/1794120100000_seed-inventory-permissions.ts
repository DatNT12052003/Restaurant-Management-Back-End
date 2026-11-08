import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Seed quyền kho nguyên liệu (giai đoạn 6). Chỉ thêm phần còn thiếu, giống các migration seed trước.
 * Giá trị được viết cứng (không import enum) để migration không đổi nghĩa nếu enum thay đổi sau này.
 */
const PERMISSIONS: [string, string][] = [
    ["inventory.view", "Xem tồn kho, phiếu kho"],
    ["inventory.import", "Lập phiếu nhập kho"],
    ["inventory.export", "Lập phiếu xuất kho"],
    ["inventory.adjust", "Kiểm kê, điều chỉnh tồn kho và ngưỡng tồn tối thiểu"],
    ["ingredient.create", "Tạo nguyên liệu"],
    ["ingredient.update", "Cập nhật nguyên liệu"],
    ["ingredient.delete", "Xóa nguyên liệu"],
];

const ALL = PERMISSIONS.map(([p]) => p);
const STOCK = ["inventory.view", "inventory.import", "inventory.export"];

const ROLE_PERMISSIONS: Record<string, string[]> = {
    admin: ALL,
    manager: ALL,
    // Bếp trưởng quản lý nguyên liệu (đặc tả 2.3)
    head_chef: ALL,
    sous_chef: STOCK,
    supervisor: ["inventory.view"],
    commis_chef: ["inventory.view"],
    barista: ["inventory.view"],
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
