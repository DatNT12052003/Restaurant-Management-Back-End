import { IAccount } from "~/interfaces";

export const getAccountsResource = (
    accounts: IAccount[],
): Pick<IAccount, "id" | "username" | "created_at" | "updated_at" | "deleted_at">[] => {
    return accounts.map((account) => ({
        id: account.id,
        username: account.username,
        created_at: account.created_at,
        updated_at: account.updated_at,
        deleted_at: account.deleted_at,
    }));
};

export const getAccountResource = (account: IAccount) => {
    return {
        id: account.id,
        username: account.username,
        created_at: account.created_at,
        updated_at: account.updated_at,
        deleted_at: account.deleted_at,
    };
};
