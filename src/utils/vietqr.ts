/**
 * Giai đoạn 14: chuỗi VietQR (chuẩn EMVCo / NAPAS 247) cho chuyển khoản đến tài khoản ngân hàng.
 * Frontend vẽ mã QR từ chuỗi này (không phụ thuộc dịch vụ ảnh bên ngoài); mọi app ngân hàng đọc được.
 */

const tlv = (id: string, value: string) => `${id}${value.length.toString().padStart(2, "0")}${value}`;

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), theo yêu cầu của EMVCo */
export const crc16 = (input: string): string => {
    let crc = 0xffff;
    for (const byte of Buffer.from(input, "utf8")) {
        crc ^= byte << 8;
        for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc.toString(16).toUpperCase().padStart(4, "0");
};

/** Nội dung chuyển khoản: chỉ chữ không dấu, số và khoảng trắng (ngân hàng có thể bỏ ký tự khác) */
export const sanitizeTransferContent = (text: string, max = 50): string =>
    text
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/đ/g, "d")
        .replace(/Đ/g, "D")
        .replace(/[^0-9A-Za-z ]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max);

export interface IVietQrInput {
    bankBin: string;
    accountNo: string;
    amount: number;
    content: string;
}

/** Chuỗi VietQR động (có số tiền và nội dung) */
export const buildVietQr = ({ bankBin, accountNo, amount, content }: IVietQrInput): string => {
    const merchant = tlv("00", "A000000727") + tlv("01", tlv("00", bankBin) + tlv("01", accountNo)) + tlv("02", "QRIBFTTA");
    const body =
        tlv("00", "01") +
        tlv("01", "12") +
        tlv("38", merchant) +
        tlv("53", "704") +
        tlv("54", String(Math.round(amount))) +
        tlv("58", "VN") +
        tlv("62", tlv("08", sanitizeTransferContent(content)));
    const withCrcTag = `${body}6304`;
    return withCrcTag + crc16(withCrcTag);
};
