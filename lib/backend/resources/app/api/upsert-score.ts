// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { ApiPayloadHandler, BackendService } from "../util"

export const handler = async(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const backendType = ApiPayloadHandler.getBackendType(event)
    const leaderboardService = BackendService.getLeaderboardService({
        rdsSecretArn: process.env["RDS_SECRET_ARN"]!,
        redisEndpointAddress: process.env["REDIS_ENDPOINT_ADDRESS"]!
    }, backendType)

    if (event.body) {
        const body = JSON.parse(event.body)
        const userId = body.user_id
        const score = parseFloat(body.score)
        console.log(`Body: ${event.body}`)
        if (!isNaN(score)) {
            try {
                console.log(`UserId: ${userId}, Score: ${score}`)
                const newRank = await leaderboardService.upsertScore(userId, score)
                return {
                    body: JSON.stringify({"new_rank": newRank}),
                    statusCode: 200,
                    headers: {
                        "Access-Control-Allow-Origin": "*"
                    }
                }
            } catch (e) {
                return {
                    body: JSON.stringify({"error_message": (e as Error).message}),
                    statusCode: 404,
                    headers: {
                        "Access-Control-Allow-Origin": "*"
                    }
                }
            }
        }
    }

    return {
        body: JSON.stringify({"error_message": "Missing required payload"}),
        statusCode: 400,
        headers: {
            "Access-Control-Allow-Origin": "*"
        }
    }
}