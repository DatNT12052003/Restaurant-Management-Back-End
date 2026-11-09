import { withTransaction } from "~/config/db";
import { reportSummaryRepository } from "~/repositories";

/** Giai đoạn 14: job đêm tổng hợp doanh thu theo ngày (báo cáo dài ngày đọc bảng tổng hợp thay vì quét `payments`) */
export const refreshDailySummary = () => withTransaction(() => reportSummaryRepository.refreshDailyPayments());

export const getSummaryState = () => reportSummaryRepository.getState();
