// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { RowDataPacket } from "mysql2";
import { ConnectionManager, ConnectionManagerProps } from "../util";
import { LeaderboardService, User, UserScore } from "./leaderboard-service";

export abstract class BaseLeaderboardService implements LeaderboardService {
    protected readonly connectionManager: ConnectionManager

    abstract retrieveTop10(): Promise<UserScore[]>
    abstract playerInfo(userId: string): Promise<UserScore>
    
    constructor(props: ConnectionManagerProps) {
        this.connectionManager = new ConnectionManager(props)
    }

    public async searchUser(searchString: string): Promise<User[]> {
        const rds = await this.connectionManager.getOrCreateRDSConnection()
        const rows = (await rds.execute("select * from users where username like ? limit 20", [`${searchString}%`]))[0] as RowDataPacket[]

        const results: User[] = []

        for (const row of rows) {
            results.push({
                id: row['id'],
                username: row['username']
            })
        }

        await this.connectionManager.cleanUp()

        return results
    }

    public async upsertScore(userId: string, score: number): Promise<number> {
        const userExists = await this.connectionManager.userExists(userId)

        if (userExists) {
            const tieBreaker = Number.MAX_SAFE_INTEGER - (new Date()).getTime()
            const markedScore = score + parseFloat((tieBreaker / parseInt(String("1").padEnd(tieBreaker.toString().length+1, '0'))).toFixed(12))

            const redis = await this.connectionManager.getOrCreateRedisConnection()
            const rds = await this.connectionManager.getOrCreateRDSConnection()

            const zaddPayload: {[key: string]: number} = {}
            zaddPayload[userId] = markedScore

            await redis.zadd(ConnectionManager.REDIS_ZSET_NAME, zaddPayload)
            await rds.execute("update leaderboard set score=? where user_id=?", [markedScore, userId])
            const newRank = await redis.zrevrank(ConnectionManager.REDIS_ZSET_NAME, userId)
            await this.connectionManager.cleanUp()
            return newRank! + 1
        }

        await this.connectionManager.cleanUp()
        throw new Error("Invalid user")
    }
}