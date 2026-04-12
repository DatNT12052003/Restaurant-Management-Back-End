import logger from "../config/logger";

const stream = {
    write: (message: string) => {
        logger.http(message.trim());
    },
};

export default stream;
