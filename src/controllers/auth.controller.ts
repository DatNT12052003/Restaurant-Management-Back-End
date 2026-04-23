import { Request, Response } from "express";
import { badRequestResponse, serverErrorResponse } from "~/common/responses/error";
import { loginSuccessResponse } from "~/common/responses/success";
import { ILoginPayload } from "~/interfaces";
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
