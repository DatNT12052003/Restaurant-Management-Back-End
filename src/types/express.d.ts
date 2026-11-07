import { JwtPayload } from "jsonwebtoken";
import { IJwtAccountPayload, IJwtResetPasswordPayload, IUser } from "~/interfaces";

declare global {
    namespace Express {
        interface Request {
            account?: JwtPayload & IJwtAccountPayload;
            reset_password_token?: JwtPayload & IJwtResetPasswordPayload;
            /** Được gán bởi `checkPermission`. */
            user?: IUser;
            /** Được gán bởi `checkPermission`. */
            roles?: string[];
            /**
             * Được gán bởi `restrictToRestaurant`.
             * `null` = được xem mọi nhà hàng (admin); số = chỉ được thao tác trên nhà hàng này.
             */
            restaurantScope?: number | null;
        }
    }
}
