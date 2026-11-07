import bcrypt from "bcrypt";
import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";
import { RolesEnum } from "../src/common/enum";
import {
    ALL_PERMISSIONS,
    AccountPermissionEnum as Account,
    EmployeePermissionEnum as Employee,
    GuestPermissionEnum as Guest,
    PermissionManagementEnum as Permission,
    RestaurantPermissionEnum as Restaurant,
    RolePermissionEnum as Role,
    RoomPermissionEnum as Room,
    TablePermissionEnum as Table,
    UserPermissionEnum as User,
} from "../src/common/permission-enum";

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Seed vai trò, quyền, ma trận quyền mặc định và tài khoản admin đầu tiên.
 *
 * Migration này chỉ THÊM dữ liệu còn thiếu (idempotent), không sửa/xóa dữ liệu đã có,
 * nên chạy an toàn trên DB đã nhập tay roles/permissions trước đó.
 *
 * Tài khoản admin chỉ được tạo khi chưa có user nào mang role admin, và khi có biến môi trường
 * SEED_ADMIN_PASSWORD (tùy chọn SEED_ADMIN_USERNAME, mặc định "admin").
 */

const ROLE_NAMES: Record<RolesEnum, string> = {
    [RolesEnum.ADMIN]: "Quản trị viên",
    [RolesEnum.MANAGER]: "Quản lý nhà hàng",
    [RolesEnum.SUPERVISOR]: "Giám sát nhà hàng",
    [RolesEnum.CASHIER]: "Thu ngân",
    [RolesEnum.RECEPTIONIST]: "Lễ tân",
    [RolesEnum.WAITSTAFF]: "Nhân viên phục vụ",
    [RolesEnum.BARISTA]: "Nhân viên pha chế",
    [RolesEnum.HEAD_CHEF]: "Bếp trưởng",
    [RolesEnum.SOUS_CHEF]: "Bếp chính",
    [RolesEnum.COMMIS_CHEF]: "Phụ bếp",
    [RolesEnum.CLEANER_STAFF]: "Nhân viên tạp vụ",
    [RolesEnum.GUARD]: "Bảo vệ",
    [RolesEnum.GUEST]: "Khách hàng",
};

const RESOURCE_LABELS: Record<string, string> = {
    user: "người dùng",
    employee: "nhân viên",
    guest: "khách hàng",
    role: "vai trò",
    restaurant: "nhà hàng",
    account: "tài khoản",
    room: "phòng",
    table: "bàn",
    permission: "phân quyền",
};

const ACTION_LABELS: Record<string, string> = {
    create: "Tạo",
    view: "Xem",
    update: "Cập nhật",
    delete: "Xóa",
    assign: "Gán",
};

const permissionLabel = (typeName: string): string => {
    const [resource, action] = typeName.split(".");
    return `${ACTION_LABELS[action] ?? action} ${RESOURCE_LABELS[resource] ?? resource}`;
};

const all = <T extends Record<string, string>>(group: T): string[] => Object.values(group);

/** Quyền mặc định của từng vai trò. Có thể điều chỉnh sau qua màn hình phân quyền (giai đoạn 1). */
const ROLE_PERMISSIONS: Record<RolesEnum, string[]> = {
    [RolesEnum.ADMIN]: ALL_PERMISSIONS,
    [RolesEnum.MANAGER]: [
        ...all(User),
        ...all(Employee),
        ...all(Guest),
        ...all(Room),
        ...all(Table),
        Restaurant.VIEW,
        Role.VIEW,
        Permission.VIEW,
        Account.VIEW,
    ],
    [RolesEnum.SUPERVISOR]: [
        Employee.VIEW,
        Guest.VIEW,
        Restaurant.VIEW,
        Room.VIEW,
        Table.VIEW,
        Table.UPDATE,
        User.UPDATE,
    ],
    [RolesEnum.CASHIER]: [Guest.VIEW, Restaurant.VIEW, Room.VIEW, Table.VIEW, User.UPDATE],
    [RolesEnum.RECEPTIONIST]: [
        Guest.CREATE,
        Guest.VIEW,
        Guest.UPDATE,
        Restaurant.VIEW,
        Room.VIEW,
        Table.VIEW,
        Table.UPDATE,
        User.UPDATE,
    ],
    [RolesEnum.WAITSTAFF]: [Restaurant.VIEW, Room.VIEW, Table.VIEW, Table.UPDATE, User.UPDATE],
    [RolesEnum.BARISTA]: [Restaurant.VIEW, User.UPDATE],
    [RolesEnum.HEAD_CHEF]: [Restaurant.VIEW, Employee.VIEW, User.UPDATE],
    [RolesEnum.SOUS_CHEF]: [Restaurant.VIEW, User.UPDATE],
    [RolesEnum.COMMIS_CHEF]: [Restaurant.VIEW, User.UPDATE],
    [RolesEnum.CLEANER_STAFF]: [Restaurant.VIEW, Room.VIEW, Table.VIEW, Table.UPDATE, User.UPDATE],
    [RolesEnum.GUARD]: [Restaurant.VIEW, User.UPDATE],
    [RolesEnum.GUEST]: [User.UPDATE],
};

const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`;

export async function up(pgm: MigrationBuilder): Promise<void> {
    // ---- roles ----
    const roleValues = Object.entries(ROLE_NAMES)
        .map(([type, name]) => `(${lit(name)}, ${lit(type)})`)
        .join(",\n            ");
    pgm.sql(`
        INSERT INTO roles (name, type_name)
        SELECT v.name, v.type_name
        FROM (VALUES
            ${roleValues}
        ) AS v(name, type_name)
        WHERE NOT EXISTS (
            SELECT 1 FROM roles r WHERE r.type_name = v.type_name AND r.deleted_at IS NULL
        )
    `);

    // ---- permissions ----
    const permissionValues = ALL_PERMISSIONS.map((p) => `(${lit(permissionLabel(p))}, ${lit(p)})`).join(
        ",\n            ",
    );
    pgm.sql(`
        INSERT INTO permissions (name, type_name)
        SELECT v.name, v.type_name
        FROM (VALUES
            ${permissionValues}
        ) AS v(name, type_name)
        WHERE NOT EXISTS (
            SELECT 1 FROM permissions p WHERE p.type_name = v.type_name AND p.deleted_at IS NULL
        )
    `);

    // ---- role_permissions ----
    const matrixValues = Object.entries(ROLE_PERMISSIONS)
        .flatMap(([role, perms]) => [...new Set(perms)].map((p) => `(${lit(role)}, ${lit(p)})`))
        .join(",\n            ");
    pgm.sql(`
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM (VALUES
            ${matrixValues}
        ) AS m(role_type, permission_type)
        JOIN roles r ON r.type_name = m.role_type AND r.deleted_at IS NULL
        JOIN permissions p ON p.type_name = m.permission_type AND p.deleted_at IS NULL
        WHERE NOT EXISTS (
            SELECT 1 FROM role_permissions rp
            WHERE rp.role_id = r.id AND rp.permission_id = p.id AND rp.deleted_at IS NULL
        )
    `);

    // ---- admin đầu tiên ----
    const adminPassword = process.env.SEED_ADMIN_PASSWORD;
    const adminUsername = process.env.SEED_ADMIN_USERNAME || "admin";
    if (!adminPassword) {
        console.warn(
            "[seed] Bỏ qua tạo tài khoản admin: chưa đặt SEED_ADMIN_PASSWORD. " +
                "(Nếu DB chưa có admin, đặt biến này rồi chạy lại: migrate:down 1 rồi migrate:up.)",
        );
        return;
    }
    const hash = bcrypt.hashSync(adminPassword, 10);
    pgm.sql(`
        WITH existing_admin AS (
            SELECT 1
            FROM users u
            JOIN user_roles ur ON ur.user_id = u.id AND ur.deleted_at IS NULL
            JOIN roles r ON r.id = ur.role_id AND r.type_name = ${lit(RolesEnum.ADMIN)} AND r.deleted_at IS NULL
            WHERE u.deleted_at IS NULL
            LIMIT 1
        ),
        new_account AS (
            INSERT INTO accounts (username, hash_password)
            SELECT ${lit(adminUsername)}, ${lit(hash)}
            WHERE NOT EXISTS (SELECT 1 FROM existing_admin)
              AND NOT EXISTS (
                  SELECT 1 FROM accounts WHERE username = ${lit(adminUsername)} AND deleted_at IS NULL
              )
            RETURNING id
        ),
        new_user AS (
            INSERT INTO users (full_name, account_id)
            SELECT ${lit(ROLE_NAMES[RolesEnum.ADMIN])}, id FROM new_account
            RETURNING id
        )
        INSERT INTO user_roles (user_id, role_id)
        SELECT nu.id, r.id
        FROM new_user nu
        JOIN roles r ON r.type_name = ${lit(RolesEnum.ADMIN)} AND r.deleted_at IS NULL
    `);
}

export async function down(): Promise<void> {
    // Không xóa dữ liệu seed khi rollback: roles/permissions có thể đã được gán cho user thật.
}
