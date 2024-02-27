// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { faker } from "@faker-js/faker"
import { ConnectionManager } from "./connection-manager"

const MAX_RECORDS = 2000000
const BATCH_SIZE = 25000
const MAX_SCORE = 1000000

const batchCreateRecords = async(conn: ConnectionManager, batchSize: number): Promise<void> => {
    const rdsConn = await conn.getOrCreateRDSConnection()
    const redis = await conn.getOrCreateRedisConnection()

    let usersSql = `insert into users values`
    let leaderboardSql = `insert into leaderboard values`
    
    let valuesSqlArr: string[] = []
    let usersValues: string[] = []
    let leaderboardValues: string[] = []

    for (let i = 0;i<batchSize;i++) {
        const userId = faker.string.uuid()
        const username = `${faker.string.alpha(12)}.${faker.person.firstName()}.${faker.person.lastName()}`.toLowerCase()
        const tieBreaker = Number.MAX_SAFE_INTEGER - faker.date.recent().getTime()
        const score = faker.number.int({max: MAX_SCORE}) + parseFloat((tieBreaker / parseInt(String("1").padEnd(tieBreaker.toString().length+1, '0'))).toFixed(12))
        valuesSqlArr.push('(?, ?)')
        usersValues.push(userId, username)
        leaderboardValues.push(userId, `${score}`)

        const zaddPayload: {[key: string]: number} = {}
        zaddPayload[userId] = score
        await redis.zadd(ConnectionManager.REDIS_ZSET_NAME, zaddPayload)
    }

    if (usersValues.length > 0) {
        const valuesPlaceholder = valuesSqlArr.join(",")
        usersSql += ` ${valuesPlaceholder}`
        leaderboardSql += ` ${valuesPlaceholder}`

        await rdsConn.beginTransaction()
        await rdsConn.execute(usersSql, usersValues)
        await rdsConn.execute(leaderboardSql, leaderboardValues)
        await rdsConn.commit()
    }
}

export const handler = async(event: any) => {
    const requestType = event["RequestType"]
    const conn = new ConnectionManager({
        rdsSecretArn: process.env["RDS_SECRET_ARN"]!,
        redisEndpointAddress: process.env["REDIS_ENDPOINT_ADDRESS"]!
    })

    if (requestType === "Create") {
        await conn.initTables()
        const numberOfBatches = MAX_RECORDS / BATCH_SIZE
        const promises = []
        for (let i = 0; i < numberOfBatches; i++) {
            promises.push(batchCreateRecords(conn, BATCH_SIZE))
        }
        await Promise.all(promises)
        await conn.cleanUp()
    }
}