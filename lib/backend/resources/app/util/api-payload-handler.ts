import { APIGatewayProxyEventV2 } from "aws-lambda";
import { BackendType } from "./backend-type";

export class ApiPayloadHandler {
    public static getBackendType(event: APIGatewayProxyEventV2) {
        const backendType: string = (event.queryStringParameters && event.queryStringParameters["backendType"]) ? event.queryStringParameters["backendType"] : "redis"

        if (backendType === "rds") {
            return BackendType.RDS
        } else {
            return BackendType.REDIS
        }
    }
}