import { IMe } from "~/interfaces";

export const getMeResource = (me: IMe) => {
    return {
        account_id: me.account_id,
        username: me.username,
        user: {
            id: me.user.id,
            full_name: me.user.full_name,
            date_of_birth: me.user.date_of_birth,
            gender: me.user.gender,
            address: me.user.address,
            email: me.user.email,
            phone_number: me.user.phone_number,
            avatar_url: me.user.avatar_url,
            status: me.user.status,
            created_at: me.user.created_at,
            account_id: me.user.account_id,
            restaurant_id: me.user.restaurant_id,
        },
        roles: me.roles,
        permissions: me.permissions,
    };
};
