import { DiscountTypeEnum } from "~/common/enum";

/** Làm tròn về đồng (VND không có phần lẻ) */
export const roundVnd = (n: number): number => Math.round(n);

/** Quy tắc giảm giá cần cho việc tính tiền */
export interface IDiscountRule {
    type: DiscountTypeEnum | string;
    value: string | number;
    min_order_value: string | number;
    max_discount: string | number | null;
}

/**
 * Số tiền giảm cho `subtotal`:
 * - Chưa đạt giá trị tối thiểu -> 0 (mã vẫn gắn với order, đủ điều kiện lại thì tự giảm tiếp).
 * - percent: subtotal × value%, không quá `max_discount`.
 * - fixed: value, không quá subtotal.
 */
export const calcDiscount = (subtotal: number, rule: IDiscountRule | null | undefined): number => {
    if (!rule || subtotal <= 0 || subtotal < Number(rule.min_order_value)) return 0;
    let amount =
        rule.type === DiscountTypeEnum.PERCENT ? roundVnd((subtotal * Number(rule.value)) / 100) : Number(rule.value);
    if (rule.max_discount !== null && rule.max_discount !== undefined) amount = Math.min(amount, Number(rule.max_discount));
    return Math.min(amount, subtotal);
};

export interface ITotals {
    subtotal: number;
    discount_amount: number;
    service_fee: number;
    tax: number;
    total: number;
}

/**
 * Tổng tiền order: net = subtotal - giảm giá; phí dịch vụ = net × rate%; thuế = (net + phí) × rate%.
 * Mọi khoản làm tròn về đồng.
 */
export const calcTotals = (
    subtotal: number,
    discountAmount: number,
    serviceFeeRate: number | string,
    taxRate: number | string,
): ITotals => {
    const net = Math.max(subtotal - discountAmount, 0);
    const service_fee = roundVnd((net * Number(serviceFeeRate)) / 100);
    const tax = roundVnd(((net + service_fee) * Number(taxRate)) / 100);
    return { subtotal, discount_amount: discountAmount, service_fee, tax, total: net + service_fee + tax };
};
