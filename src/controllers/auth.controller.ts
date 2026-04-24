import { Request, Response } from "express";
import { badRequestResponse, serverErrorResponse } from "~/common/responses/error";
import { getSuccessResponse, loginSuccessResponse } from "~/common/responses/success";
import { IJwtPayload, ILoginPayload } from "~/interfaces";
import { authService } from "~/services";

export const login = async (req: Request, res: Response) => {
    try {
        const body: ILoginPayload = req.body;
        if (!body.username || !body.password) {
            return badRequestResponse(res, req.t("auth:username_password_required"));
        }

        const authData = await authService.login(body);

        if (!authData) {
            return badRequestResponse(res, req.t("auth:invalid_username_or_password"));
        }
        return loginSuccessResponse(res, req.t("auth:login_successfully"), authData);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const getMe = async (req: Request, res: Response) => {
    try {
        const account_id = req.account?.account_id;
        const username = req.account?.username;
        if (!account_id || !username) {
            return badRequestResponse(res, req.t("auth:invalid_token"));
        }
        const payload: IJwtPayload = { account_id, username };
        const meData = await authService.getMe(payload);
        if (!meData) {
            return badRequestResponse(res, req.t("auth:user_not_found"));
        }
        return getSuccessResponse(res, req.t("auth:get_me_successfully"), meData);
    } catch (error) {
        return serverErrorResponse(res);
    }
};
