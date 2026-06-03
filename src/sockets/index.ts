import { Server as HttpServer } from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    //SocketData,
} from "~/interfaces";

//let io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
let io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents>;

export const initSocket = (server: HttpServer): Server => {
    io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"],
        },
    });

    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;
        if (!token) {
            return next(new Error("common:authorization_header_missing"));
        }

        try {
            const payload = jwt.verify(token, process.env.ACCESS_SECRET!) as any;
            socket.data.account = payload;
            next();
        } catch (err) {
            return next(new Error("common:invalid_or_expired_token"));
        }
    });

    io.on("connection", (socket) => {
        console.log(`✅ Socket mới kết nối: ${socket.id}`);
        //registerChatHandlers(io, socket);
        // socket.on("join-room", ({ roomId }) => {
        //     socket.join(roomId);

        //     socket.emit("room:joined", roomId);

        //     console.log(`${socket.id} joined room ${roomId}`);
        // });

        // socket.on("leave-room", ({ roomId }) => {
        //     socket.leave(roomId);
        //     socket.emit("room:left", roomId);
        //     console.log(`${socket.id} left room ${roomId}`);
        // });

        //console.log("Socket data sau khi auth:", socket.data);

        socket.on("disconnect", () => {
            console.log(`🔴 Socket ${socket.id} đã ngắt kết nối`);
        });
    });

    return io;
};

// Hàm Helper để lấy instance io ở bất kỳ file nào khác (ví dụ từ Controller REST API)
export const getIO = () => {
    console.log("🚀 getIO() được gọi, kiểm tra io:", io ? "Đã khởi tạo" : "Chưa khởi tạo");
    if (!io) {
        throw new Error("Socket.io chưa được khởi tạo!");
    }
    return io;
};
