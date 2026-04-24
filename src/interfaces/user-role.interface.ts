export interface IUserRole {
    id: number;
    user_id: number;
    role_id: number;
    created_at: Date;
    updated_at: Date;
    deleted_at?: Date | null;
}

export interface ICreateUserRolePayload extends Omit<IUserRole, "id" | "created_at" | "updated_at" | "deleted_at"> {}

export interface IUpdateUserRolePayload extends Partial<
    Omit<IUserRole, "id" | "created_at" | "updated_at" | "deleted_at">
> {}
