import logger from "~/config/logger";
import { auditLogService } from "~/services";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Chạy `job` sau `delayMs`, rồi lặp lại mỗi `intervalMs`. Lỗi chỉ được log, không làm dừng server. */
const schedule = (name: string, job: () => Promise<unknown>, delayMs: number, intervalMs: number) => {
    const run = async () => {
        try {
            const result = await job();
            logger.info(`Job ${name} done`, { result });
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
};
