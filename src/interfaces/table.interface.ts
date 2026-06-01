export interface ITable {
    id: number;
    name: string;
    status: string;
    room_id: number;
    created_at: Date;
    updated_at: Date;
    deleted_at?: Date | null;
}
