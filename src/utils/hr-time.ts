/**
 * Thời gian cho phân hệ nhân sự. Mọi ngày / giờ ca làm theo giờ Việt Nam (UTC+7, không có giờ mùa hè),
 * nên ghép ngày + giờ thành mốc thời gian bằng offset cố định.
 */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" + "HH:MM[:SS]" (giờ Việt Nam) -> Date */
export const vnDateTime = (date: string, time: string): Date => new Date(`${date}T${time.length === 5 ? `${time}:00` : time}+07:00`);

/** Ngày (giờ Việt Nam) của một mốc thời gian, dạng "YYYY-MM-DD" */
export const vnDate = (at: Date): string => new Date(at.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);

export const todayVn = (): string => vnDate(new Date());

export const addDays = (date: string, days: number): string =>
    new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Các ngày từ `from` tới `to` (gồm cả hai đầu) */
export const eachDay = (from: string, to: string): string[] => {
    const days: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
    return days;
};

export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** "YYYY-MM" hoặc "YYYY-MM-DD" -> ngày đầu và ngày cuối tháng */
export const monthRange = (month: string): { start: string; end: string } => {
    const [y, m] = month.split("-").map(Number);
    const start = `${y}-${String(m).padStart(2, "0")}-01`;
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    return { start, end };
};

/** Giờ bắt đầu / kết thúc ca từ ngày làm và giờ; giờ kết thúc <= giờ bắt đầu nghĩa là ca qua đêm */
export const shiftWindow = (date: string, start: string, end: string): { start_at: Date; end_at: Date } => {
    const startAt = vnDateTime(date, start);
    let endAt = vnDateTime(date, end);
    if (endAt <= startAt) endAt = new Date(endAt.getTime() + DAY_MS);
    return { start_at: startAt, end_at: endAt };
};

export const minutesBetween = (a: Date, b: Date): number => Math.round((b.getTime() - a.getTime()) / 60000);
