import { JwtPayload } from "jsonwebtoken";
import { IJwtPayload } from "~/interfaces";

declare global {
    namespace Express {
        interface Request {
            account?: JwtPayload & IJwtPayload;
        }
    }
}
