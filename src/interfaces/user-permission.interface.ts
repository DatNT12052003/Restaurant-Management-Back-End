export interface IUserPermission {
    id: number;
    user_id: number;
    permission_id: number;
    created_at: Date;
    updated_at: Date;
    deleted_at?: Date | null;
}

export interface ICreateUserPermissionBody extends Omit<
    IUserPermission,
    "id" | "created_at" | "updated_at" | "deleted_at"
> {}

export interface ICreateUserPermissionPayload extends ICreateUserPermissionBody {}
