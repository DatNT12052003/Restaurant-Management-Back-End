import { transporter } from "~/config/mailer";
import { ISendEmail } from "~/interfaces";

export const sendMail = (data: ISendEmail) => {
    return transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: data.to,
        subject: data.subject,
        html: data.html,
    });
};
