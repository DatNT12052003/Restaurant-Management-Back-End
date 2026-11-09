import Transport from "winston-transport";
import logger from "./logger";

/**
 * Giai đoạn 14: giám sát lỗi.
 * - Đặt `SENTRY_DSN` thì gửi lỗi lên Sentry (hoặc dịch vụ tương thích Sentry như GlitchTip tự cài). Không đặt thì tắt,
 *   SDK không được nạp.
 * - Mọi `logger.error(...)` (lỗi không bắt được, job lỗi, webhook lỗi...) đều được chuyển lên Sentry qua một transport
 *   của winston, nên không phải gọi Sentry rải rác trong code.
 * - Lỗi không bắt được của tiến trình (unhandledRejection / uncaughtException) cũng được ghi log.
 */

type SentryModule = typeof import("@sentry/node");

let sentry: SentryModule | null = null;

class SentryTransport extends Transport {
    log(info: Record<string, unknown>, next: () => void) {
        setImmediate(() => this.emit("logged", info));
        if (sentry && info.level === "error") {
            const { message, stack, error, ...extra } = info;
            const err = new Error(String(message));
            if (typeof stack === "string") err.stack = stack;
            sentry.captureException(err, { extra: { ...extra, error } });
        }
        next();
    }
}

export const initMonitoring = () => {
    const dsn = process.env.SENTRY_DSN;
    if (dsn) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        sentry = require("@sentry/node") as SentryModule;
        sentry.init({
            dsn,
            environment: process.env.APP_ENV || process.env.NODE_ENV || "development",
            release: process.env.APP_VERSION || undefined,
            tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
        });
        logger.add(new SentryTransport({ level: "error" }));
        logger.info("Error monitoring enabled (Sentry)");
    }

    process.on("unhandledRejection", (reason) => {
        logger.error("Unhandled promise rejection", {
            message: (reason as Error)?.message ?? String(reason),
            stack: (reason as Error)?.stack,
        });
    });
    process.on("uncaughtException", (error) => {
        logger.error("Uncaught exception", { message: error.message, stack: error.stack });
        // Trạng thái tiến trình không còn tin cậy: đợi gửi lỗi rồi thoát để Docker khởi động lại
        void flushMonitoring().finally(() => process.exit(1));
    });
};

export const flushMonitoring = async (timeoutMs = 2000) => {
    if (sentry) await sentry.flush(timeoutMs);
};
