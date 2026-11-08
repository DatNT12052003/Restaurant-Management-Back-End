import { db } from "~/config/db";
import { IInventoryLot, ILotTaken } from "~/interfaces";

/**
 * Lô hàng và hạn dùng (giai đoạn 11). Lô chỉ theo dõi số lượng theo hạn dùng; giá vốn vẫn là bình quân gia quyền.
 * Tổng số lượng các lô có thể nhỏ hơn tồn kho (phần nhập trước khi bật theo dõi, hoặc tăng do kiểm kê).
 */

export const createLot = async (row: {
    restaurant_id: number;
    ingredient_id: number;
    lot_code: string | null;
    expiry_date: string;
    quantity: number;
    receipt_id?: number | null;
    transfer_id?: number | null;
}): Promise<{ id: number }> => {
    const result = await db().query(
        `INSERT INTO inventory_lots (restaurant_id, ingredient_id, lot_code, expiry_date, initial_quantity, quantity, receipt_id, transfer_id)
        VALUES ($1, $2, $3, $4::date, $5, $5, $6, $7) RETURNING id`,
        [row.restaurant_id, row.ingredient_id, row.lot_code, row.expiry_date, row.quantity, row.receipt_id ?? null, row.transfer_id ?? null],
    );
    return result.rows[0];
};

/**
 * Trừ \`quantity\` khỏi các lô còn hàng theo FEFO (hết hạn sớm nhất trước). Khóa các lô FOR UPDATE.
 * Thiếu lô thì trừ hết phần có (phần còn lại là tồn không gắn lô). Trả về các phần đã lấy.
 * \`lotId\`: chỉ trừ lô này (phiếu hủy đúng một lô).
 */
export const takeFromLots = async (
    restaurantId: number,
    ingredientId: number,
    quantity: number,
    lotId?: number | null,
): Promise<ILotTaken[]> => {
    const result = await db().query(
        `SELECT id, lot_code, to_char(expiry_date, 'YYYY-MM-DD') AS expiry_date, quantity FROM inventory_lots
        WHERE restaurant_id = $1 AND ingredient_id = $2 AND quantity > 0 AND ($3::int IS NULL OR id = $3::int)
        ORDER BY expiry_date, id
        FOR UPDATE`,
        [restaurantId, ingredientId, lotId ?? null],
    );
    const taken: ILotTaken[] = [];
    let rest = Math.round(quantity * 1000) / 1000;
    for (const lot of result.rows) {
        if (rest <= 0) break;
        const take = Math.min(rest, Number(lot.quantity));
        await db().query("UPDATE inventory_lots SET quantity = quantity - $2, updated_at = NOW() WHERE id = $1", [lot.id, take]);
        taken.push({ lot_id: lot.id, lot_code: lot.lot_code, expiry_date: lot.expiry_date, quantity: Math.round(take * 1000) / 1000 });
        rest = Math.round((rest - take) * 1000) / 1000;
    }
    return taken;
};

export const getLotById = async (id: number): Promise<IInventoryLot | undefined> => {
    const result = await db().query(
        "SELECT *, to_char(expiry_date, 'YYYY-MM-DD') AS expiry_date FROM inventory_lots WHERE id = $1",
        [id],
    );
    return result.rows[0];
};

/** Lô còn hàng của chi nhánh; \`expiringDays\`: chỉ lô hết hạn trong số ngày tới (gồm lô đã hết hạn) */
export const getLots = async (
    restaurantId: number,
    options: { ingredientId?: number; expiringDays?: number } = {},
): Promise<IInventoryLot[]> => {
    const result = await db().query(
        `SELECT l.id, l.restaurant_id, l.ingredient_id, g.name AS ingredient_name, g.unit, l.lot_code,
            to_char(l.expiry_date, 'YYYY-MM-DD') AS expiry_date, l.initial_quantity, l.quantity, l.receipt_id, l.transfer_id,
            r.code AS receipt_code, l.created_at,
            (l.expiry_date - (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) AS days_left,
            ROUND(l.quantity * COALESCE(inv.avg_unit_cost, 0), 2) AS value
        FROM inventory_lots l
        JOIN ingredients g ON g.id = l.ingredient_id
        LEFT JOIN inventory_receipts r ON r.id = l.receipt_id
        LEFT JOIN inventory inv ON inv.restaurant_id = l.restaurant_id AND inv.ingredient_id = l.ingredient_id
        WHERE l.restaurant_id = $1 AND l.quantity > 0
            AND ($2::int IS NULL OR l.ingredient_id = $2::int)
            AND ($3::int IS NULL OR l.expiry_date <= (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + $3::int)
        ORDER BY l.expiry_date, lower(g.name), l.id`,
        [restaurantId, options.ingredientId ?? null, options.expiringDays ?? null],
    );
    return result.rows;
};

/** Số lô sắp hết hạn / đã hết hạn còn hàng (cho cảnh báo) */
export const countExpiring = async (restaurantId: number, days: number): Promise<{ expiring: number; expired: number }> => {
    const result = await db().query(
        `SELECT
            COUNT(*) FILTER (WHERE expiry_date < (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)::int AS expired,
            COUNT(*) FILTER (WHERE expiry_date >= (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
                AND expiry_date <= (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + $2::int)::int AS expiring
        FROM inventory_lots WHERE restaurant_id = $1 AND quantity > 0`,
        [restaurantId, days],
    );
    return result.rows[0];
};
