// export interface MessagePayload {
//     sender: string;
//     text: string;
//     createdAt?: string;
// }

// Các event Server gửi về cho Client lắng nghe
export interface ServerToClientEvents {
    //    "message:received": (data: MessagePayload) => void;
    "user:typing": (username: string) => void;
    "room:joined": (roomId: string) => void;
    "room:left": (roomId: string) => void;
}

// Các event Client gửi lên cho Server lắng nghe
export interface ClientToServerEvents {
    //    "message:send": (data: MessagePayload) => void;
    "join-room": (data: { roomId: string }) => void;
    "leave-room": (data: { roomId: string }) => void;
}

export interface InterServerEvents {}

// Định nghĩa dữ liệu lưu trữ trong mỗi Socket Session sau khi Auth thành công
// export interface SocketData {
//     account: {
//         // id: string;
//         // username: string;
//         // role: string;
//         // [key: string]: any;
//     };
// }
