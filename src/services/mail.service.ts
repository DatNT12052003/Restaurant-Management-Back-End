import { transporter } from "~/config/mailer";
import { ISendEmail } from "~/interfaces";

/** Khi chạy test (`NODE_ENV=test`) không gửi mail thật: lưu vào đây để test đọc */
export const testOutbox: ISendEmail[] = [];

export const sendMail = (data: ISendEmail) => {
    if (process.env.NODE_ENV === "test") {
        testOutbox.push(data);
        return Promise.resolve();
    }
    return transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: data.to,
        subject: data.subject,
        html: data.html,
    });
};
