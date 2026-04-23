import { Request, Response } from "express";
import { badRequestResponse, createErrorResponse, serverErrorResponse } from "~/common/responses/error";
import { createSuccessResponse } from "~/common/responses/success";
import { IAccount, ICreateUserPayload, ICreateUserWithAccountPayload, IUser, IResponse } from "~/interfaces";
import { userService } from "~/services";
import { uploadToCloudinary } from "~/utils/cloudinary";

export const createUser = async (req: Request, res: Response) => {
    try {
        const body: ICreateUserPayload = req.body;

        if (!body.full_name) {
            return badRequestResponse(res, req.t("user:full_name_required"));
        }

        if (!req.file) {
            body.avatar_url = null;
        }

        const newUser: IUser | null = await userService.createUser(body);

        if (!newUser) {
            return createErrorResponse(res, req.t("user:error_creating_user"));
        }

        return createSuccessResponse(res, req.t("user:user_created_successfully"), newUser);
    } catch (error) {
        serverErrorResponse(res);
    }
};

export const createUserWithAccount = async (req: Request, res: Response) => {
    try {
        const body: ICreateUserWithAccountPayload = req.body;

        if (!body.user.full_name) {
            return badRequestResponse(res, req.t("user:full_name_required"));
        }

        if (req.file) {
            const result = await uploadToCloudinary(req.file.buffer);
            body.user.avatar_url = result.secure_url;
        } else {
            body.user.avatar_url = null;
        }

        const newUserWithAccount: { user: IUser; account: IAccount } | null =
            await userService.createUserWithAccount(body);

        if (!newUserWithAccount) {
            return createErrorResponse(res, req.t("user:error_creating_user_with_account"));
        }

        return createSuccessResponse(res, req.t("user:user_with_account_created_successfully"), newUserWithAccount);
    } catch (error) {
        console.error("Error in createUserWithAccount:", error);
        serverErrorResponse(res);
    }
};
