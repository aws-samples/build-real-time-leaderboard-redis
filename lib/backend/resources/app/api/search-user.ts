// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { ApiPayloadHandler, BackendService, ConnectionManager } from "../util"
import { RowDataPacket } from "mysql2"

export const handler = async(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const backendType = ApiPayloadHandler.getBackendType(event)
    const leaderboardService = BackendService.getLeaderboardService({
        rdsSecretArn: process.env["RDS_SECRET_ARN"]!,
        redisEndpointAddress: process.env["REDIS_ENDPOINT_ADDRESS"]!
    }, backendType)

    if (event.queryStringParameters && event.queryStringParameters.username) {
        const username = event.queryStringParameters.username
        const rows = await leaderboardService.searchUser(username)

        return {
            body: JSON.stringify(rows),
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*"
            }
        }
    }

    return {
        body: JSON.stringify({"error_message": "Missing required parameter"}),
        statusCode: 400,
        headers: {
            "Access-Control-Allow-Origin": "*"
        }
    }
}