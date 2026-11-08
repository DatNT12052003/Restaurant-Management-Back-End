import { Request, Response } from "express";
import { ACCOUNT_ADMIN } from "~/common/error-code/account";
import {
    badRequestResponse,
    createErrorResponse,
    notFoundResponse,
    serverErrorResponse,
} from "~/common/responses/error";
import { createSuccessResponse, getSuccessResponse, successResponse } from "~/common/responses/success";
import { IAccount, ICreateAccountBody, IGetQuery } from "~/interfaces";
import { withRestaurantScope } from "~/middlewares/restaurantScope.middleware";
import { listAccountsSchema } from "~/schemas";
import { accountService } from "~/services";
import { auditContext } from "~/utils/audit";
import { buildListParams } from "~/utils/pagination";

export const createAccount = async (req: Request, res: Response) => {
    try {
        const { username, password }: ICreateAccountBody = req.body;

        if (!username || !password) {
            return badRequestResponse(res, req.t("account:username_password_required"));
        }

        const newAccount: IAccount | number = await accountService.createAccount({ username, password });

        if (typeof newAccount === "number") {
            return createErrorResponse(res, req.t("account:error_creating_account"));
        }

        return createSuccessResponse(res, req.t("account:account_created_successfully"), newAccount);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

// ---------------------------------------------------------------------------
// Trang Tài khoản
// ---------------------------------------------------------------------------

/** Danh sách tài khoản kèm người dùng. Express 5 parse lại `req.query` mỗi lần đọc -> parse lại bằng schema. */
export const getAccounts = async (req: Request, res: Response) => {
    try {
        const query = req.query as IGetQuery;
        const extra = listAccountsSchema.shape.query.parse(req.query);
        const filters = withRestaurantScope(query.filters, "restaurant_id", req.restaurantScope ?? extra.restaurant_id);
        const params = buildListParams({ ...query, filters });
        const result = await accountService.getAccountList(params, { kind: extra.kind, locked: extra.locked });
        if (typeof result === "number") {
            return createErrorResponse(res, req.t("account:error_getting_accounts"));
        }
        return getSuccessResponse(res, req.t("account:get_accounts_successfully"), result);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

/** Chạy một thao tác trên tài khoản của `req.targetUser` (đã qua `canManageTargetUser`) */
const manageAccount =
    (key: string, run: (req: Request) => Promise<unknown>) =>
    async (req: Request, res: Response) => {
        try {
            const result = await run(req);
            if (result === ACCOUNT_ADMIN.NO_ACCOUNT) return notFoundResponse(res, req.t("account:no_account"));
            if (typeof result === "number") return createErrorResponse(res, req.t(`account:${key}_failed`));
            return successResponse(res, req.t(`account:${key}_successfully`), result);
        } catch (error) {
            return serverErrorResponse(res);
        }
    };

export const unlockAccount = manageAccount("unlock", (req) => accountService.unlockAccount(req.targetUser!, auditContext(req)));

export const logoutAllDevices = manageAccount("logout_all", (req) =>
    accountService.logoutAllDevices(req.targetUser!, auditContext(req)),
);

export const resetAccountPassword = manageAccount("reset_password", (req) =>
    accountService.resetAccountPassword(req.targetUser!, req.body, auditContext(req)),
);
