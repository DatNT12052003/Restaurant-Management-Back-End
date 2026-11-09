import { randomBytes } from "crypto";
import { IEInvoice, IEInvoiceIssued, IEInvoiceProvider } from "~/interfaces";
import { eInvoiceRepository } from "~/repositories";

/**
 * Giai đoạn 14: nhà cung cấp hóa đơn điện tử (câu hỏi 12: chưa chốt hợp đồng -> lớp trừu tượng + giả lập).
 *
 * Thêm nhà cung cấp thật (VNPT Invoice, Viettel S-Invoice, MISA meInvoice...): viết một `IEInvoiceProvider`
 * (gọi API phát hành / hủy của nhà cung cấp, map `IEInvoice.lines` sang định dạng của họ), đăng ký vào `PROVIDERS`,
 * rồi đặt `EINVOICE_PROVIDER=<tên>` cùng các biến kết nối riêng của nhà cung cấp đó.
 */

/** Điều khiển nhà cung cấp giả lập trong test */
export const mockEInvoiceControl = {
    /** Số lần gọi tiếp theo sẽ lỗi */
    failNext: 0,
    message: "Mock provider unavailable",
    issued: [] as number[],
    cancelled: [] as number[],
    reset() {
        this.failNext = 0;
        this.issued = [];
        this.cancelled = [];
    },
};

const mockProvider: IEInvoiceProvider = {
    name: "mock",
    async issue(invoice: IEInvoice): Promise<IEInvoiceIssued> {
        if (mockEInvoiceControl.failNext > 0) {
            mockEInvoiceControl.failNext--;
            throw new Error(mockEInvoiceControl.message);
        }
        const series = invoice.series ?? "1C00MCK";
        const number = await eInvoiceRepository.nextMockNumber(series);
        const lookup = randomBytes(6).toString("hex").toUpperCase();
        mockEInvoiceControl.issued.push(invoice.id);
        return {
            series,
            invoice_no: String(number).padStart(8, "0"),
            lookup_code: lookup,
            lookup_url: null,
            provider_ref: `MOCK-${invoice.id}-${lookup}`,
            issued_at: new Date(),
        };
    },
    async cancel(invoice: IEInvoice): Promise<void> {
        if (mockEInvoiceControl.failNext > 0) {
            mockEInvoiceControl.failNext--;
            throw new Error(mockEInvoiceControl.message);
        }
        mockEInvoiceControl.cancelled.push(invoice.id);
    },
};

const PROVIDERS: Record<string, IEInvoiceProvider> = {
    mock: mockProvider,
};

/** Tên nhà cung cấp đang cấu hình (không kiểm tra; dùng khi tạo hóa đơn để không bao giờ làm hỏng việc hoàn tất order) */
export const eInvoiceProviderName = (): string => (process.env.EINVOICE_PROVIDER || "mock").toLowerCase();

/** Nhà cung cấp đang dùng (`EINVOICE_PROVIDER`, mặc định giả lập). Tên lạ thì báo lỗi lúc gửi (hóa đơn chuyển failed). */
export const getEInvoiceProvider = (): IEInvoiceProvider => {
    const name = eInvoiceProviderName();
    const provider = PROVIDERS[name];
    if (!provider) throw new Error(`Unknown EINVOICE_PROVIDER "${name}"`);
    return provider;
};
