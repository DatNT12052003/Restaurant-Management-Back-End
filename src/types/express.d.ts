import { JwtPayload } from "jsonwebtoken";
import { IJwtAccountPayload, IJwtResetPasswordPayload } from "~/interfaces";

declare global {
    namespace Express {
        interface Request {
            account?: JwtPayload & IJwtAccountPayload;
            reset_password_token?: JwtPayload & IJwtResetPasswordPayload;
        }
    }
}
