export interface IAccount {
    id: number;
    username: string;
    hash_password: string;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
}
