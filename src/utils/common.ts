export const stringToDate = (dateStr: string | null | undefined): Date | null => {
    if (!dateStr) return null;
    const [year, month, day] = dateStr.split("-").map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
};

export const dateToString = (date: Date | null | undefined): string | null => {
    if (!date) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};

export const generateOTP = (length: number = 6): string => {
    const digits = "0123456789";
    let otp = "";
    for (let i = 0; i < length; i++) {
        otp += digits[Math.floor(Math.random() * 10)];
    }
    return otp;
};
