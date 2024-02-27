// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { RowDataPacket } from "mysql2";
import { ConnectionManagerProps } from "../util";
import { BaseLeaderboardService } from "./base-leaderboard-service";
import { UserScore } from "./leaderboard-service";

export class RdsLeaderboardService extends BaseLeaderboardService {

    constructor(props: ConnectionManagerProps) {
        super(props)
    }

    async retrieveTop10(): Promise<UserScore[]> {
        const rds = await this.connectionManager.getOrCreateRDSConnection()
        const results = (await rds.execute("select a.*, b.score from users a inner join leaderboard b on a.id=b.user_id order by b.score desc limit 10"))[0] as RowDataPacket[]
        const response: UserScore[] = []
        let startRank = 0
        for (const row of results) {
            response.push({
                user_id: row.id,
                username: row.username,
                score: row.score,
                rank: ++startRank
            })
        }

        await this.connectionManager.cleanUp()
        return response
    }

    async playerInfo(userId: string): Promise<UserScore> {
        const userExists = await this.connectionManager.userExists(userId)

        if (userExists) {
            const rds = await this.connectionManager.getOrCreateRDSConnection()
            const computedRank = (await rds.execute("SELECT l1.score, u.username,(SELECT COUNT(*) FROM leaderboard l2 WHERE l2.score>=l1.score) AS user_rank FROM leaderboard l1 inner join users u on l1.user_id=u.id WHERE l1.user_id=?", [userId]))[0] as RowDataPacket[]
            await this.connectionManager.cleanUp()
            return {
                user_id: userId,
                username: computedRank[0].username,
                rank: computedRank[0].user_rank,
                score: computedRank[0].score
            }
        }

        await this.connectionManager.cleanUp()
        throw new Error("User not found")
    }

}