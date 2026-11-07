export interface IRole {
    id: number;
    name: string;
    type_name: string;
    created_at: Date;
    updated_at: Date;
    deleted_at?: Date | null;
}

export interface ICreateRoleBody extends Pick<IRole, "name" | "type_name"> {}

export interface ICreateRolePayload extends Omit<IRole, "id" | "created_at" | "updated_at" | "deleted_at"> {}

export interface IRoleWithPermissions extends Pick<IRole, "id" | "name" | "type_name"> {
    permissions: string[];
    user_count: number;
    /** Người dùng hiện tại có được sửa quyền của role này không */
    editable: boolean;
}
