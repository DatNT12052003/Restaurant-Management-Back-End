import logger from "~/config/logger";
import { auditLogService, reservationService } from "~/services";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Chạy `job` sau `delayMs`, rồi lặp lại mỗi `intervalMs`. Lỗi chỉ được log, không làm dừng server.
 * `quiet`: job chạy dày (mỗi phút) chỉ ghi log khi có thay đổi.
 */
const schedule = (name: string, job: () => Promise<unknown>, delayMs: number, intervalMs: number, quiet = false) => {
    const run = async () => {
        try {
            const result = await job();
            const changed = typeof result !== "object" || result === null || Object.values(result).some((v) => v);
            if (!quiet || changed) logger.info(`Job ${name} done`, { result });
        } catch (error) {
            logger.error(`Job ${name} failed`, { error: (error as Error).message });
        }
    };
    setTimeout(run, delayMs).unref();
    setInterval(run, intervalMs).unref();
};

/** Các job định kỳ, gọi một lần khi server khởi động */
export const startScheduledJobs = () => {
    // Lưu trữ nhật ký cũ hơn 12 tháng: chạy 1 phút sau khi khởi động, sau đó mỗi ngày
    schedule("archive-audit-logs", () => auditLogService.archiveOldAuditLogs(), 60 * 1000, DAY_MS);
    // Giữ bàn trước giờ hẹn, trả bàn và đánh dấu khách không đến (câu hỏi 8): mỗi phút
    schedule("reservation-holds", () => reservationService.syncReservationHolds(), 15 * 1000, 60 * 1000, true);
};
