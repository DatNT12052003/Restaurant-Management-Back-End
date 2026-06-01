import { GET_ALL_TABLES } from "~/common/error-code/table";
import { ITable } from "~/interfaces";
import { tableRepository } from "~/repositories";

export const getAllTables = async (): Promise<ITable[] | number> => {
    try {
        const tables = await tableRepository.getAllTables();
        return tables;
    } catch (error) {
        return GET_ALL_TABLES.GET_ALL_TABLES_FAILED;
    }
};
