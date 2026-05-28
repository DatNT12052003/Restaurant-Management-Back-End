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

export const updateEmployeeResource = ({
    updatedUser,
    updatedAccount,
    roles,
}: {
    updatedUser: IUser;
    updatedAccount: IAccount;
    roles: string[];
}) => {
    return {
        user: getUserResource(updatedUser),
        account: getAccountResource(updatedAccount),
        roles,
    };
};
