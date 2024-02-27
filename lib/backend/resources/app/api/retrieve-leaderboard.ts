// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { ApiPayloadHandler, BackendService } from "../util";

export const handler = async(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const backendType = ApiPayloadHandler.getBackendType(event)
    const leaderboardService = BackendService.getLeaderboardService({
        rdsSecretArn: process.env["RDS_SECRET_ARN"]!,
        redisEndpointAddress: process.env["REDIS_ENDPOINT_ADDRESS"]!
    }, backendType)

    const responseBody = await leaderboardService.retrieveTop10()

    return {
        statusCode: 200,
        headers: {
            "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify(responseBody)
    }
}