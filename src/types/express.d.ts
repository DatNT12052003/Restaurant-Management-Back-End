import { JwtPayload } from "jsonwebtoken";
import { IJwtAccountPayload, IJwtResetPasswordPayload, IUser } from "~/interfaces";

declare global {
    namespace Express {
        interface Request {
            account?: JwtPayload & IJwtAccountPayload;
            reset_password_token?: JwtPayload & IJwtResetPasswordPayload;
            user?: IUser;
        }
    }
}
