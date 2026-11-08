/** Giai đoạn 12: mã lỗi chung của phân hệ nhân sự (ca làm, chấm công, nghỉ phép, lương) */
export const HR_ERROR = {
    FAILED: 0,
    /** Admin phải chỉ định chi nhánh */
    RESTAURANT_REQUIRED: 1,
    RESTAURANT_NOT_FOUND: 2,
    /** Nhân viên không tồn tại, không thuộc chi nhánh, hoặc là khách */
    STAFF_NOT_FOUND: 3,
    /** Người thao tác không có cấp cao hơn nhân viên (hoặc tự duyệt / tự sửa cho mình) */
    CANNOT_MANAGE: 4,
    TEMPLATE_NOT_FOUND: 5,
    TEMPLATE_DUPLICATE: 6,
    SHIFT_NOT_FOUND: 7,
    /** Ca bị trùng giờ với ca khác của cùng người */
    SHIFT_OVERLAP: 8,
    /** Ca đã có chấm công: không xóa / đổi được */
    SHIFT_HAS_ATTENDANCE: 9,
    /** Thiếu giờ bắt đầu / kết thúc (không chọn ca mẫu) hoặc giờ không hợp lệ */
    SHIFT_INVALID_TIME: 10,
    SWAP_NOT_FOUND: 11,
    /** Trạng thái yêu cầu không cho phép thao tác này */
    INVALID_STATUS: 12,
    /** Ca đã bắt đầu / đã qua, hoặc không phải ca của người xin đổi / người nhận */
    SWAP_INVALID_SHIFT: 13,
    /** Mã QR sai, hết hạn hoặc của chi nhánh khác */
    QR_INVALID: 14,
    ATTENDANCE_NOT_FOUND: 15,
    /** Giờ ra trước giờ vào, hoặc đang có lượt chưa ra ca */
    ATTENDANCE_INVALID: 16,
    /** Lượt chấm công không có tăng ca chờ duyệt */
    NO_OVERTIME: 17,
    LEAVE_NOT_FOUND: 18,
    /** Trùng với đơn nghỉ khác đang chờ / đã duyệt */
    LEAVE_OVERLAP: 19,
    /** Đã thuộc bảng lương đã chốt: không thay đổi được */
    PAYROLL_LOCKED: 20,
    PAYROLL_NOT_FOUND: 21,
    ALLOWANCE_NOT_FOUND: 22,
    ADJUSTMENT_NOT_FOUND: 23,
    /** Đã có mức lương áp dụng từ ngày này */
    COMPENSATION_DUPLICATE: 24,
    /** Kỳ lương chưa kết thúc: chưa chốt được */
    PAYROLL_NOT_ENDED: 25,
    /** Nhân viên chưa có mức lương nào */
    COMPENSATION_MISSING: 26,
};
