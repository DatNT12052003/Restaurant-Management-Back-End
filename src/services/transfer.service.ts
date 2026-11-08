import { InventoryTransactionTypeEnum, StockTransferStatusEnum, SupplierBillStatusEnum } from "~/common/enum";
import { PAYABLE_ERROR, TRANSFER_ERROR } from "~/common/error-code/purchasing";
import { rollback, withTransaction } from "~/config/db";
import {
    IAuditContext,
    ICreateTransferBody,
    IGetStockTransfers,
    IGetSupplierBills,
    IInventoryRow,
    IPayBillBody,
    IReceiveTransferBody,
    ISelectQuery,
    IStockTransfer,
    ISupplierBill,
} from "~/interfaces";
import { inventoryRepository, lotRepository, purchasingRepository, restaurantRepository } from "~/repositories";
import { writeAudit } from "~/utils/audit";
import { buildPagination } from "~/utils/pagination";
import { emitInventoryChanged } from "./inventory.service";
import { inScope } from "./room.service";

/** `scope`: null = mọi nhà hàng (admin); số = chỉ nhà hàng này. */
type Scope = number | null | undefined;

const T = StockTransferStatusEnum;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

const isLow = (row: IInventoryRow, after: number) => after < 0 || (Number(row.min_quantity) > 0 && after <= Number(row.min_quantity));

/**
 * Cộng hàng vào kho một chi nhánh (nhận chuyển kho / hoàn lại khi hủy phiếu), giá bình quân gia quyền theo `unit_cost`,
 * tạo lại các lô theo thứ tự hạn dùng đã lấy ở chi nhánh gửi. Gọi trong transaction.
 */
const addStock = async (
    restaurantId: number,
    transferId: number,
    items: { ingredient_id: number; quantity: number; unit_cost: number; lots: { lot_code: string | null; expiry_date: string; quantity: number }[] }[],
    actorId: number | null,
    reason: string | null,
) => {
    const rows = await inventoryRepository.lockInventoryRows(restaurantId, items.map((i) => i.ingredient_id));
    const low: number[] = [];
    const txns = [];
    for (const item of items) {
        if (item.quantity <= 0) continue;
        const row = rows.get(item.ingredient_id)!;
        const before = Number(row.quantity);
        const positive = Math.max(before, 0);
        const avg = round2((positive * Number(row.avg_unit_cost) + item.quantity * item.unit_cost) / (positive + item.quantity));
        const after = round3(before + item.quantity);
        await inventoryRepository.updateInventoryRow(restaurantId, item.ingredient_id, after, avg);
        if (isLow(row, after)) low.push(item.ingredient_id);
        // Lô: lấy theo thứ tự hạn dùng tới đủ số lượng nhận (phần không gắn lô ở bên gửi thì không có lô)
        let rest = item.quantity;
        for (const lot of item.lots) {
            if (rest <= 0) break;
            const take = round3(Math.min(rest, lot.quantity));
            if (take <= 0) continue;
            await lotRepository.createLot({
                restaurant_id: restaurantId,
                ingredient_id: item.ingredient_id,
                lot_code: lot.lot_code,
                expiry_date: lot.expiry_date,
                quantity: take,
                transfer_id: transferId,
            });
            rest = round3(rest - take);
        }
        txns.push({
            restaurant_id: restaurantId,
            ingredient_id: item.ingredient_id,
            receipt_id: null,
            type: InventoryTransactionTypeEnum.TRANSFER_IN,
            quantity_change: item.quantity,
            quantity_after: after,
            unit_price: item.unit_cost,
            reason,
            created_by: actorId,
            reference_type: "stock_transfer",
            reference_id: transferId,
        });
    }
    await inventoryRepository.insertTransactions(txns);
    return { ids: items.filter((i) => i.quantity > 0).map((i) => i.ingredient_id), low };
};

const detail = async (id: number): Promise<IStockTransfer | undefined> => {
    const transfer = await purchasingRepository.getTransferById(id);
    if (!transfer) return undefined;
    return { ...transfer, lines: await purchasingRepository.getTransferLines(id) };
};

/** Người bị giới hạn nhà hàng chỉ thấy phiếu chi nhánh mình gửi hoặc nhận */
const visible = (t: IStockTransfer, scope: Scope) =>
    scope === null || scope === undefined || t.from_restaurant_id === scope || t.to_restaurant_id === scope;

/**
 * Chi nhánh nhận được chọn khi chuyển kho: mọi nhà hàng đang hoạt động trừ chi nhánh gửi.
 * Người không phải admin chỉ thấy chi nhánh của mình ở bộ chọn chi nhánh, nên cần danh sách rút gọn này (chỉ id, tên).
 */
export const getDestinations = async (scope: Scope, from?: number): Promise<{ id: number; name: string }[] | number> => {
    try {
        const source = scope ?? from ?? null;
        return (await restaurantRepository.getAllRestaurants(null))
            .filter((r) => r.id !== source && r.status !== "blocked")
            .map((r) => ({ id: r.id, name: r.name }));
    } catch (error) {
        return TRANSFER_ERROR.FAILED;
    }
};

export const getTransfers = async (params: ISelectQuery, scope: Scope, restaurantId?: number): Promise<IGetStockTransfers | number> => {
    try {
        const branch = scope ?? restaurantId;
        const conditions = branch ? [`(st.from_restaurant_id = ${Number(branch)} OR st.to_restaurant_id = ${Number(branch)})`] : [];
        const result = await purchasingRepository.getTransfers({ ...params, conditions });
        return { transfers: result.rows, pagination: buildPagination(params, result.totalCount) };
    } catch (error) {
        return TRANSFER_ERROR.FAILED;
    }
};

export const getTransfer = async (id: number, scope: Scope): Promise<IStockTransfer | number> => {
    try {
        const transfer = await detail(id);
        if (!transfer || !visible(transfer, scope)) return TRANSFER_ERROR.NOT_FOUND;
        return transfer;
    } catch (error) {
        return TRANSFER_ERROR.FAILED;
    }
};

/**
 * Xuất phiếu chuyển kho: trừ kho chi nhánh gửi ngay (không vượt tồn), theo giá bình quân của bên gửi, lấy lô theo FEFO.
 * Phiếu ở trạng thái đang chuyển cho tới khi chi nhánh nhận xác nhận.
 */
export const createTransfer = async (body: ICreateTransferBody, scope: Scope, audit: IAuditContext): Promise<IStockTransfer | number> => {
    try {
        const result = await withTransaction(async () => {
            const from = scope ?? body.from_restaurant_id;
            if (!from || !(await restaurantRepository.getRestaurantById(from))) return rollback(TRANSFER_ERROR.RESTAURANT_REQUIRED);
            if (body.to_restaurant_id === from || !(await restaurantRepository.getRestaurantById(body.to_restaurant_id))) {
                return rollback(TRANSFER_ERROR.INVALID_DESTINATION);
            }
            const ids = body.lines.map((l) => l.ingredient_id);
            const ingredients = new Map((await inventoryRepository.getIngredientsByIds(ids)).map((g) => [g.id, g]));
            if (ingredients.size !== ids.length) return rollback(TRANSFER_ERROR.INVALID_INGREDIENTS);

            const rows = await inventoryRepository.lockInventoryRows(from, ids);
            const code = await purchasingRepository.nextTransferCode(from);
            const transfer = await purchasingRepository.createTransfer({
                code,
                from_restaurant_id: from,
                to_restaurant_id: body.to_restaurant_id,
                note: body.note ?? null,
                created_by: audit.userId ?? null,
            });
            const lines = [];
            const txns = [];
            const low: number[] = [];
            for (const l of body.lines) {
                const row = rows.get(l.ingredient_id)!;
                const qty = round3(l.quantity);
                const before = Number(row.quantity);
                if (qty > before) return rollback(TRANSFER_ERROR.INSUFFICIENT_STOCK);
                const avg = Number(row.avg_unit_cost);
                const after = round3(before - qty);
                await inventoryRepository.updateInventoryRow(from, l.ingredient_id, after, avg);
                if (isLow(row, after)) low.push(l.ingredient_id);
                const taken = ingredients.get(l.ingredient_id)!.track_expiry
                    ? await lotRepository.takeFromLots(from, l.ingredient_id, qty)
                    : [];
                lines.push({
                    ingredient_id: l.ingredient_id,
                    quantity: qty,
                    unit_cost: avg,
                    lots: taken.map(({ lot_code, expiry_date, quantity }) => ({ lot_code, expiry_date, quantity })),
                });
                txns.push({
                    restaurant_id: from,
                    ingredient_id: l.ingredient_id,
                    receipt_id: null,
                    type: InventoryTransactionTypeEnum.TRANSFER_OUT,
                    quantity_change: -qty,
                    quantity_after: after,
                    unit_price: avg,
                    reason: body.note ?? null,
                    created_by: audit.userId ?? null,
                    reference_type: "stock_transfer",
                    reference_id: transfer.id,
                });
            }
            await purchasingRepository.insertTransferLines(transfer.id, lines);
            await inventoryRepository.insertTransactions(txns);
            await writeAudit(audit, {
                action: "inventory.transfer",
                entity_type: "stock_transfer",
                entity_id: transfer.id,
                restaurant_id: from,
                after: { code, to_restaurant_id: body.to_restaurant_id, lines: lines.map((x) => ({ ingredient_id: x.ingredient_id, quantity: x.quantity })) },
            });
            return { id: transfer.id, from, ids, low };
        });
        if (typeof result === "number") return result;
        emitInventoryChanged(result.from, result.ids, result.low);
        return (await detail(result.id))!;
    } catch (error) {
        return TRANSFER_ERROR.FAILED;
    }
};

/**
 * Chi nhánh nhận xác nhận số thực nhận (bỏ trống = nhận đủ). Hàng cộng vào kho bên nhận theo giá vốn bên gửi, lô được tạo lại.
 * Phần thiếu (gửi - thực nhận) là hao hụt vận chuyển, ghi vào `loss_value` và nhật ký.
 */
export const receiveTransfer = async (
    id: number,
    body: IReceiveTransferBody,
    scope: Scope,
    audit: IAuditContext,
): Promise<IStockTransfer | number> => {
    try {
        const result = await withTransaction(async () => {
            const transfer = await purchasingRepository.getTransferById(id, true);
            if (!transfer || !visible(transfer, scope)) return rollback(TRANSFER_ERROR.NOT_FOUND);
            if (transfer.status !== T.IN_TRANSIT) return rollback(TRANSFER_ERROR.INVALID_STATUS);
            if (scope && scope !== transfer.to_restaurant_id) return rollback(TRANSFER_ERROR.WRONG_BRANCH);

            const lines = await purchasingRepository.getTransferLines(id);
            const given = new Map((body.lines || []).map((l) => [l.line_id, round3(l.received_quantity)]));
            if ([...given.keys()].some((lineId) => !lines.some((l) => l.id === lineId))) return rollback(TRANSFER_ERROR.INVALID_LINES);
            const items = lines.map((l) => {
                const received = given.get(l.id) ?? Number(l.quantity);
                return { line: l, received };
            });
            if (items.some((i) => i.received > Number(i.line.quantity) + 1e-9)) return rollback(TRANSFER_ERROR.INVALID_LINES);

            for (const i of items) await purchasingRepository.setTransferLineReceived(i.line.id, i.received);
            const added = await addStock(
                transfer.to_restaurant_id,
                id,
                items.map((i) => ({
                    ingredient_id: i.line.ingredient_id,
                    quantity: i.received,
                    unit_cost: Number(i.line.unit_cost),
                    lots: i.line.lots,
                })),
                audit.userId ?? null,
                body.note ?? null,
            );
            const loss = round2(items.reduce((s, i) => s + (Number(i.line.quantity) - i.received) * Number(i.line.unit_cost), 0));
            await purchasingRepository.updateTransfer(id, {
                status: T.RECEIVED,
                received_by: audit.userId ?? null,
                received_at: new Date(),
                loss_value: loss,
            });
            await writeAudit(audit, {
                action: "inventory.transfer_receive",
                entity_type: "stock_transfer",
                entity_id: id,
                restaurant_id: transfer.to_restaurant_id,
                after: {
                    code: transfer.code,
                    loss_value: loss,
                    lines: items.map((i) => ({ ingredient_id: i.line.ingredient_id, sent: Number(i.line.quantity), received: i.received })),
                },
            });
            return { to: transfer.to_restaurant_id, ...added };
        });
        if (typeof result === "number") return result;
        emitInventoryChanged(result.to, result.ids, result.low);
        return (await detail(id))!;
    } catch (error) {
        return TRANSFER_ERROR.FAILED;
    }
};

/** Hủy phiếu đang chuyển (chi nhánh gửi): hoàn hàng và lô về kho bên gửi */
export const cancelTransfer = async (id: number, scope: Scope, audit: IAuditContext): Promise<IStockTransfer | number> => {
    try {
        const result = await withTransaction(async () => {
            const transfer = await purchasingRepository.getTransferById(id, true);
            if (!transfer || !visible(transfer, scope)) return rollback(TRANSFER_ERROR.NOT_FOUND);
            if (transfer.status !== T.IN_TRANSIT) return rollback(TRANSFER_ERROR.INVALID_STATUS);
            if (scope && scope !== transfer.from_restaurant_id) return rollback(TRANSFER_ERROR.WRONG_BRANCH);
            const lines = await purchasingRepository.getTransferLines(id);
            const added = await addStock(
                transfer.from_restaurant_id,
                id,
                lines.map((l) => ({ ingredient_id: l.ingredient_id, quantity: Number(l.quantity), unit_cost: Number(l.unit_cost), lots: l.lots })),
                audit.userId ?? null,
                `${transfer.code}: cancelled`,
            );
            await purchasingRepository.updateTransfer(id, { status: T.CANCELLED, cancelled_at: new Date() });
            await writeAudit(audit, {
                action: "inventory.transfer_cancel",
                entity_type: "stock_transfer",
                entity_id: id,
                restaurant_id: transfer.from_restaurant_id,
                before: { code: transfer.code, status: transfer.status },
                after: { status: T.CANCELLED },
            });
            return { from: transfer.from_restaurant_id, ...added };
        });
        if (typeof result === "number") return result;
        emitInventoryChanged(result.from, result.ids, result.low);
        return (await detail(id))!;
    } catch (error) {
        return TRANSFER_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// Công nợ nhà cung cấp
// ---------------------------------------------------------------------------

export const getBills = async (params: ISelectQuery, overdueOnly: boolean): Promise<IGetSupplierBills | number> => {
    try {
        const conditions = overdueOnly
            ? ["b.status <> 'paid' AND b.due_date < (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date"]
            : [];
        const withConditions = { ...params, conditions };
        const [result, summary] = await Promise.all([purchasingRepository.getBills(withConditions), purchasingRepository.sumBills(withConditions)]);
        return { bills: result.rows, pagination: buildPagination(params, result.totalCount), summary };
    } catch (error) {
        return PAYABLE_ERROR.FAILED;
    }
};

export const getBill = async (id: number, scope: Scope): Promise<ISupplierBill | number> => {
    try {
        const bill = await purchasingRepository.getBillById(id);
        if (!bill || !inScope(bill.restaurant_id, scope)) return PAYABLE_ERROR.NOT_FOUND;
        return { ...bill, payments: await purchasingRepository.getBillPayments(id) };
    } catch (error) {
        return PAYABLE_ERROR.FAILED;
    }
};

/** Ghi một lần trả tiền cho nhà cung cấp (một phần hoặc trả hết); ghi nhật ký */
export const payBill = async (id: number, body: IPayBillBody, scope: Scope, audit: IAuditContext): Promise<ISupplierBill | number> => {
    try {
        const result = await withTransaction(async () => {
            const bill = await purchasingRepository.getBillById(id, true);
            if (!bill || !inScope(bill.restaurant_id, scope)) return rollback(PAYABLE_ERROR.NOT_FOUND);
            if (bill.status === SupplierBillStatusEnum.PAID) return rollback(PAYABLE_ERROR.ALREADY_PAID);
            const remaining = round2(Number(bill.amount) - Number(bill.paid_amount));
            const amount = round2(body.amount);
            if (amount > remaining) return rollback(PAYABLE_ERROR.AMOUNT_EXCEEDS);
            await purchasingRepository.insertBillPayment({
                bill_id: id,
                amount,
                method: body.method,
                reference: body.reference ?? null,
                note: body.note ?? null,
                paid_at: body.paid_at ?? new Date(),
                created_by: audit.userId ?? null,
            });
            const paid = round2(Number(bill.paid_amount) + amount);
            const status = paid >= Number(bill.amount) ? SupplierBillStatusEnum.PAID : SupplierBillStatusEnum.PARTIAL;
            await purchasingRepository.setBillPaid(id, paid, status);
            await writeAudit(audit, {
                action: "payable.pay",
                entity_type: "supplier_bill",
                entity_id: id,
                restaurant_id: bill.restaurant_id,
                before: { paid_amount: bill.paid_amount, status: bill.status },
                after: { amount, method: body.method, paid_amount: paid, status, supplier_id: bill.supplier_id },
            });
            return { id };
        });
        if (typeof result === "number") return result;
        return getBill(id, scope);
    } catch (error) {
        return PAYABLE_ERROR.FAILED;
    }
};
