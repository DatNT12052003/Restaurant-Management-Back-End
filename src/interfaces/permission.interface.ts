export interface IPermission {
    id: number;
    name: string;
    type_name: string;
    created_at: Date;
    updated_at: Date;
    deleted_at?: Date | null;
}

export interface ICreatePermissionPayload extends Omit<
    IPermission,
    "id" | "created_at" | "updated_at" | "deleted_at"
> {}

export interface IUpdatePermissionPayload extends Partial<
    Omit<IPermission, "id" | "created_at" | "updated_at" | "deleted_at">
> {}
