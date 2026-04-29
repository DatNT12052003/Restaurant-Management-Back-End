export interface IPermission {
    id: number;
    name: string;
    type_name: string;
    created_at: Date;
    updated_at: Date;
    deleted_at?: Date | null;
}

export interface ICreatePermissionBody extends Pick<IPermission, "name" | "type_name"> {}
