import { IRestaurant } from "~/interfaces";

export const getRestaurantsResource = (
    restaurants: IRestaurant[],
): Partial<IRestaurant>[] => {
    // Gồm cả cấu hình (phí, thuế, giờ mở cửa, giữ bàn) để form sửa trên giao diện không ghi đè bằng giá trị mặc định
    return restaurants.map((restaurant) => ({
        id: restaurant.id,
        name: restaurant.name,
        status: restaurant.status,
        address: restaurant.address,
        service_fee_percent: restaurant.service_fee_percent,
        tax_percent: restaurant.tax_percent,
        open_time: restaurant.open_time,
        close_time: restaurant.close_time,
        reservation_hold_minutes: restaurant.reservation_hold_minutes,
        no_show_after_minutes: restaurant.no_show_after_minutes,
    }));
};
