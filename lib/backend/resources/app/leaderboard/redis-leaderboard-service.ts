// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { RowDataPacket } from "mysql2";
import { ConnectionManager, ConnectionManagerProps } from "../util";
import { BaseLeaderboardService } from "./base-leaderboard-service";
import { UserScore } from "./leaderboard-service";


export class RedisLeaderboardService extends BaseLeaderboardService {
    
    constructor(props: ConnectionManagerProps) {
        super(props)
    }

    async retrieveTop10(): Promise<UserScore[]> {
        const rds = await this.connectionManager.getOrCreateRDSConnection()
        const redis = await this.connectionManager.getOrCreateRedisConnection()

        const leaderboardResponse = await redis.zrevrange(ConnectionManager.REDIS_ZSET_NAME, 0, 9, "WITHSCORES")
        let startRank = 0
        const userIds = Object.keys(leaderboardResponse);

        const placeholders = Array(userIds.length).fill('?')
    
        const rows = (await rds.execute(`select * from users where id in (${placeholders.join(',')})`, userIds))[0] as RowDataPacket[]
        const usernameMap: {[key: string]: string} = {}
        const responseBody: UserScore[] = []
    
        rows.forEach((row) => {
            usernameMap[row.id] = row.username
        })
    
        userIds.forEach((userId) => {
            responseBody.push({
                user_id: userId,
                username: usernameMap[userId],
                rank: ++startRank,
                score: parseFloat(leaderboardResponse[userId])
            })
        }) 
    
        await this.connectionManager.cleanUp()

        return responseBody
    }
    async playerInfo(userId: string): Promise<UserScore> {
        const userExists = await this.connectionManager.userExists(userId)

        if (userExists) {
            const rds = await this.connectionManager.getOrCreateRDSConnection()
            const redis = await this.connectionManager.getOrCreateRedisConnection()

            const rows = (await rds.execute("select * from users where id=?", [userId]))[0] as RowDataPacket[]
            const username = rows[0].username

            let rank = await redis.zrevrank(ConnectionManager.REDIS_ZSET_NAME, userId)

            if (rank) {
                rank += 1
            } else {
                rank = -1
            }
    
            let scoreResp = await redis.zscore(ConnectionManager.REDIS_ZSET_NAME, userId)
            let score = -1
    
            if (scoreResp) {
                score = parseFloat(scoreResp)
            }

            await this.connectionManager.cleanUp()

            return {
                user_id: userId,
                username,
                rank,
                score
            }
        }

        await this.connectionManager.cleanUp()
        throw new Error("User not found")
    }

}