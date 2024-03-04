// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { RowDataPacket } from "mysql2";
import { ConnectionManager, ConnectionManagerProps } from "../util";
import { BaseLeaderboardService } from "./base-leaderboard-service";
import { User, UserScore } from "./leaderboard-service";


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
        const cachedUsers = await this.getUsersFromCache(userIds)
        const cachedUserIds = Object.keys(cachedUsers)
        
        const usernameMap: {[key: string]: string} = cachedUsers

        if (cachedUserIds.length < userIds.length) {
            const filteredUserIds = userIds.filter((userId) => !cachedUserIds.includes(userId))

            const placeholders = Array(filteredUserIds.length).fill('?')
            const rows = (await rds.execute(`select * from users where id in (${placeholders.join(',')})`, filteredUserIds))[0] as RowDataPacket[]

            const usersForCaching: User[] = []
            rows.forEach((row) => {
                usernameMap[row.id] = row.username
                usersForCaching.push({
                    id: row.id,
                    username: row.username
                })
            })

            await this.cacheUsers(usersForCaching)
        }

        const responseBody: UserScore[] = []
        
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

            const cachedUsername = await redis.hget(ConnectionManager.REDIS_USER_CACHE_NAME, userId)
            let username = null

            if (!cachedUsername) {
                const rows = (await rds.execute("select * from users where id=?", [userId]))[0] as RowDataPacket[]
                username = rows[0].username
                await redis.hset(ConnectionManager.REDIS_USER_CACHE_NAME, userId, username)
            } else {
                username = cachedUsername
            }

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

    /**
     * We're doing the caching on the first read. Alternatively, this can also be done during user registration
     * @param userIds List of user IDs to retrieve
     */
    private async getUsersFromCache(userIds: string[]): Promise<{[key: string]: string}> {
        const cachedUsers: {[key: string]: string} = {}

        if (userIds && userIds.length > 0) {
            const redis = await this.connectionManager.getOrCreateRedisConnection()
            const usernames = await redis.hmget(ConnectionManager.REDIS_USER_CACHE_NAME, userIds[0], ...userIds)        

            if (usernames && usernames.length > 0) {
                for (let i=0;i<usernames.length;i++) {
                    if (usernames[i]) {
                        cachedUsers[userIds[i]] = usernames[i]!
                    }
                }
            }
        }
    
        return cachedUsers
    }

    private async cacheUsers(users: User[]) {
        if (users && users.length > 0) {
            const payload: {[key: string]: string} = {}

            for (const user of users) {
                payload[user.id] = user.username
            }

            const redis = await this.connectionManager.getOrCreateRedisConnection()
            await redis.hmset(ConnectionManager.REDIS_USER_CACHE_NAME, payload)
        }
    }
}