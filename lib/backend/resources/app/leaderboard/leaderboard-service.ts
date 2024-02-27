// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export interface UserScore {
    user_id: string,
    username: string,
    score: number,
    rank: number
}

export interface User {
    id: string,
    username: string
}

export interface LeaderboardService {
    retrieveTop10(): Promise<UserScore[]>
    playerInfo(userId: string): Promise<UserScore>
    searchUser(searchString: string): Promise<User[]>
    upsertScore(userId: string, score: number): Promise<number>
}