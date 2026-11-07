import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { RolesEnum, UserStatusEnum } from "~/common/enum";
import { isAdmin } from "~/common/role-level";
import { ClientToServerEvents, InterServerEvents, ServerToClientEvents, SocketData } from "~/interfaces";
import { getRolesByUserId } from "~/repositories/role.repository";
import { getUserByAccountId } from "~/repositories/user.repository";

type AppServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

let io: AppServer | undefined;

const KITCHEN_ROLES: string[] = [RolesEnum.HEAD_CHEF, RolesEnum.SOUS_CHEF, RolesEnum.COMMIS_CHEF];
const BAR_ROLES: string[] = [RolesEnum.BARISTA];
const FLOOR_ROLES: string[] = [
    RolesEnum.MANAGER,
    RolesEnum.SUPERVISOR,
    RolesEnum.CASHIER,
    RolesEnum.RECEPTIONIST,
    RolesEnum.WAITSTAFF,
];

export const restaurantRoom = (restaurantId: number) => `restaurant:${restaurantId}`;

/** Các room của một nhà hàng mà người có `roles` được nhận sự kiện */
const roomsFor = (restaurantId: number, roles: string[]): string[] => {
    const base = restaurantRoom(restaurantId);
    const rooms = [base];
    const all = isAdmin(roles);
    if (all || roles.some((r) => KITCHEN_ROLES.includes(r))) rooms.push(`${base}:kitchen`);
    if (all || roles.some((r) => BAR_ROLES.includes(r))) rooms.push(`${base}:bar`);
    if (all || roles.some((r) => FLOOR_ROLES.includes(r))) rooms.push(`${base}:floor`);
    return rooms;
};

const leaveRestaurantRooms = (socket: AppSocket) => {
    [...socket.rooms].filter((r) => r.startsWith("restaurant:")).forEach((r) => socket.leave(r));
};

export const initSocket = (server: HttpServer): AppServer => {
    io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"],
        },
    });

    // Xác thực bằng access token, rồi nạp user để biết nhà hàng và vai trò
    io.use(async (socket, next) => {
        const token = socket.handshake.auth?.token;
        if (!token) {
            return next(new Error("common:authorization_header_missing"));
        }

        try {
            const payload = jwt.verify(token, process.env.ACCESS_SECRET!) as { account_id: number; username: string };
            socket.data.account = payload;
        } catch (err) {
            return next(new Error("common:invalid_or_expired_token"));
        }

        try {
            const user = await getUserByAccountId(socket.data.account.account_id);
            if (!user || user.status === UserStatusEnum.INACTIVE) {
                return next(new Error("common:authentication_required"));
            }
            const roles = await getRolesByUserId(user.id);
            socket.data.userId = user.id;
            socket.data.isAdmin = isAdmin(roles);
            // Nhân viên tự vào room của nhà hàng mình; admin chọn nhà hàng qua `restaurant:subscribe`
            socket.data.restaurantId = socket.data.isAdmin ? null : user.restaurant_id;
            if (!socket.data.isAdmin && user.restaurant_id) {
                socket.join(roomsFor(user.restaurant_id, roles));
            }
            next();
        } catch (err) {
            next(new Error("common:error"));
        }
    });

    io.on("connection", (socket) => {
        socket.on("restaurant:subscribe", (restaurantId) => {
            // Nhân viên không được nghe nhà hàng khác
            if (!socket.data.isAdmin) return;
            leaveRestaurantRooms(socket);
            const id = Number(restaurantId) || null;
            socket.data.restaurantId = id;
            if (id) socket.join(roomsFor(id, [RolesEnum.ADMIN]));
            socket.emit("restaurant:subscribed", id);
        });
    });

    return io;
};

/** Lấy instance io (ví dụ để emit từ REST API). Ném lỗi nếu chưa khởi tạo. */
export const getIO = (): AppServer => {
    if (!io) {
        throw new Error("Socket.io chưa được khởi tạo!");
    }
    return io;
};

/**
 * Gửi sự kiện tới mọi người của nhà hàng. Gọi SAU khi transaction đã commit.
 * Không làm hỏng request nếu socket chưa khởi tạo (ví dụ khi chạy script).
 */
export const emitToRestaurant = <E extends keyof ServerToClientEvents>(
    restaurantId: number,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
): void => {
    if (!io) return;
    io.to(restaurantRoom(restaurantId)).emit(event, ...args);
};
