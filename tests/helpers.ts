import bcrypt from "bcrypt";
import request from "supertest";
import app from "~/app";
import { pool } from "~/config/db";

export const PASSWORD = "Test@12345";

/** Các bảng giữ nguyên giữa các file test (seed của migration) */
const KEEP = ["pgmigrations", "roles", "permissions", "role_permissions", "_test_role_permissions"];

export const q = async <T = any>(sql: string, params: unknown[] = []): Promise<T[]> => (await pool.query(sql, params)).rows;

export const api = () => request(app);

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * Xóa sạch dữ liệu (giữ seed vai trò / quyền) trước mỗi file test. Ma trận quyền của vai trò được khôi phục
 * từ bản chụp lần đầu, để test sửa quyền của vai trò không ảnh hưởng file khác.
 */
export const resetDatabase = async () => {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query(`CREATE TABLE IF NOT EXISTS _test_role_permissions AS
            SELECT role_id, permission_id FROM role_permissions WHERE deleted_at IS NULL`);
        const tables = (
            await client.query(
                `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT (tablename = ANY($1))`,
                [KEEP],
            )
        ).rows.map((r) => `"${r.tablename}"`);
        // Bảng nhật ký có trigger chặn TRUNCATE
        await client.query("ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_protect_truncate");
        await client.query("ALTER TABLE audit_logs_archive DISABLE TRIGGER audit_logs_archive_protect_truncate");
        await client.query(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`);
        await client.query("ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_protect_truncate");
        await client.query("ALTER TABLE audit_logs_archive ENABLE TRIGGER audit_logs_archive_protect_truncate");
        await client.query("DELETE FROM role_permissions");
        await client.query(`INSERT INTO role_permissions (role_id, permission_id)
            SELECT role_id, permission_id FROM _test_role_permissions`);
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

// ---------------------------------------------------------------------------
// Dữ liệu mẫu (ghi thẳng vào DB, nhanh hơn đi qua API)
// ---------------------------------------------------------------------------

export const createRestaurant = async (name: string, extra: Record<string, unknown> = {}) => {
    const fields = { name, address: `${name} - địa chỉ`, ...extra };
    const keys = Object.keys(fields);
    const [row] = await q<{ id: number }>(
        `INSERT INTO restaurants (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
        Object.values(fields),
    );
    return row.id;
};

export const createRoom = async (restaurantId: number, name: string, type = "public") => {
    const [row] = await q<{ id: number }>(
        "INSERT INTO rooms (name, type, restaurant_id) VALUES ($1, $2, $3) RETURNING id",
        [name, type, restaurantId],
    );
    return row.id;
};

export const createTable = async (roomId: number, name: string, capacity = 4) => {
    const [row] = await q<{ id: number }>(
        "INSERT INTO tables (name, capacity, room_id) VALUES ($1, $2, $3) RETURNING id",
        [name, capacity, roomId],
    );
    return row.id;
};

export const createDish = async (name: string, price: number, category = "food") => {
    const [row] = await q<{ id: number }>(
        "INSERT INTO dishes (name, price, category) VALUES ($1, $2, $3) RETURNING id",
        [name, price, category],
    );
    return row.id;
};

export const createIngredient = async (name: string, unit = "kg") => {
    const [row] = await q<{ id: number }>("INSERT INTO ingredients (name, unit) VALUES ($1, $2) RETURNING id", [name, unit]);
    return row.id;
};

export interface ITestUser {
    userId: number;
    accountId: number;
    username: string;
    token: string;
}

let userSeq = 0;

/** Tạo user có tài khoản và vai trò, rồi đăng nhập lấy access token */
export const createUser = async (
    roles: string | string[],
    restaurantId: number | null,
    options: { username?: string; fullName?: string; status?: string; login?: boolean } = {},
): Promise<ITestUser> => {
    const list = ([] as string[]).concat(roles);
    const username = options.username ?? `${list[0]}_${++userSeq}`;
    const [account] = await q<{ id: number }>(
        "INSERT INTO accounts (username, hash_password) VALUES ($1, $2) RETURNING id",
        [username, bcrypt.hashSync(PASSWORD, 4)],
    );
    const [user] = await q<{ id: number }>(
        "INSERT INTO users (full_name, account_id, restaurant_id, status) VALUES ($1, $2, $3, $4) RETURNING id",
        [options.fullName ?? `User ${username}`, account.id, restaurantId, options.status ?? "active"],
    );
    await q("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE type_name = ANY($2)", [user.id, list]);
    const token = options.login === false ? "" : await login(username);
    return { userId: user.id, accountId: account.id, username, token };
};

export const login = async (username: string, password = PASSWORD): Promise<string> => {
    const res = await api().post("/api/auth/login").send({ username, password });
    if (res.status !== 200) throw new Error(`Login ${username} failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.data.access_token;
};

/**
 * Bộ dữ liệu chung: 2 nhà hàng; nhà hàng 1 có phòng chung (4 bàn) và phòng riêng (2 bàn);
 * nhà hàng 2 có 1 phòng 2 bàn; nhân viên theo vai trò.
 */
export const baseFixture = async () => {
    const r1 = await createRestaurant("Nhà hàng Một");
    const r2 = await createRestaurant("Nhà hàng Hai");
    const hall = await createRoom(r1, "Sảnh");
    const vip = await createRoom(r1, "VIP", "private");
    const r2room = await createRoom(r2, "Sảnh 2");
    const tables = {
        t1: await createTable(hall, "B1", 4),
        t2: await createTable(hall, "B2", 4),
        t3: await createTable(hall, "B3", 2),
        t4: await createTable(hall, "B4", 6),
        v1: await createTable(vip, "V1", 8),
        v2: await createTable(vip, "V2", 8),
        x1: await createTable(r2room, "X1", 4),
        x2: await createTable(r2room, "X2", 4),
    };
    const users = {
        admin: await createUser("admin", null),
        manager: await createUser("manager", r1),
        manager2: await createUser("manager", r2),
        supervisor: await createUser("supervisor", r1),
        cashier: await createUser("cashier", r1),
        receptionist: await createUser("receptionist", r1),
        waiter: await createUser("waitstaff", r1),
        waiter2: await createUser("waitstaff", r2),
        chef: await createUser("head_chef", r1),
        sousChef: await createUser("sous_chef", r1),
        barista: await createUser("barista", r1),
    };
    return { r1, r2, rooms: { hall, vip, r2room }, tables, users };
};

export type Fixture = Awaited<ReturnType<typeof baseFixture>>;

/** Đọc các dòng nhật ký theo hành động (mới nhất sau cùng) */
export const auditRows = (action: string) =>
    q("SELECT * FROM audit_logs WHERE action = $1 ORDER BY id", [action]);

/** auditRoute ghi nhật ký sau khi response đã gửi: chờ một nhịp trước khi đọc */
export const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
