import { AsyncLocalStorage } from "async_hooks";
import { Pool, PoolClient } from "pg";
import dotenv from "dotenv";

dotenv.config();

export const pool = new Pool({
    // connectionString: process.env.DATABASE_URL,
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT),
    ssl: false,
    // ssl: {
    //     rejectUnauthorized: false,
    // },
});

interface ITransactionContext {
    client: PoolClient;
    rollbackOnly: boolean;
}

const transactionStorage = new AsyncLocalStorage<ITransactionContext>();

/**
 * Trả về connection đang dùng cho transaction hiện tại (nếu có), ngược lại trả về pool.
 * Repository luôn gọi `db().query(...)` thay vì `pool.query(...)` để tự động tham gia transaction.
 */
export const db = (): Pick<Pool, "query"> => transactionStorage.getStore()?.client ?? pool;

/** Ném ra bên trong `withTransaction` để rollback và trả về `value` (thường là mã lỗi số của service). */
export class TransactionRollback<T = unknown> extends Error {
    constructor(public readonly value: T) {
        super("Transaction rolled back");
    }
}

export const rollback = <T>(value: T): never => {
    throw new TransactionRollback(value);
};

/**
 * Chạy `fn` trong một transaction trên cùng một connection.
 * - `fn` trả về bình thường -> COMMIT.
 * - `rollback(code)` -> ROLLBACK và trả về `code`.
 * - Lỗi khác -> ROLLBACK và ném lỗi tiếp.
 * Gọi lồng nhau sẽ dùng lại transaction bên ngoài; `rollback` ở trong khiến transaction ngoài cũng bị rollback.
 */
export const withTransaction = async <T, R = never>(fn: () => Promise<T>): Promise<T | R> => {
    const current = transactionStorage.getStore();
    if (current) {
        try {
            return await fn();
        } catch (error) {
            current.rollbackOnly = true;
            if (error instanceof TransactionRollback) {
                return error.value as R;
            }
            throw error;
        }
    }

    const client = await pool.connect();
    const context: ITransactionContext = { client, rollbackOnly: false };
    try {
        await client.query("BEGIN");
        const result = await transactionStorage.run(context, fn);
        await client.query(context.rollbackOnly ? "ROLLBACK" : "COMMIT");
        return result;
    } catch (error) {
        await client.query("ROLLBACK");
        if (error instanceof TransactionRollback) {
            return error.value as R;
        }
        throw error;
    } finally {
        client.release();
    }
};
