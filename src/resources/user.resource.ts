import { IAccount, IUser } from "~/interfaces";
import { getAccountResource } from "~/resources";

export const getUserResource = (user: IUser) => {
    return {
        id: user.id,
        full_name: user.full_name,
        date_of_birth: user.date_of_birth,
        gender: user.gender,
        address: user.address,
        email: user.email,
        phone_number: user.phone_number,
        avatar_url: user.avatar_url,
        status: user.status,
        account_id: user.account_id,
        restaurant_id: user.restaurant_id,
    };
};

export const createEmployeeResource = ({
    user,
    account,
    roles,
}: {
    user: IUser;
    account: IAccount;
    roles: string[];
}) => {
    return {
        user: getUserResource(user),
        account: getAccountResource(account),
        roles,
    };
};

export const updateEmployeeResource = createEmployeeResource;

export const createGuestResource = ({ user, account }: { user: IUser; account: IAccount }) => {
    return {
        user: getUserResource(user),
        account: getAccountResource(account),
    };
};

export const updateGuestResource = createGuestResource;
