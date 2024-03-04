// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import {GetSecretValueCommand, SecretsManagerClient} from "@aws-sdk/client-secrets-manager"
import mysql, { RowDataPacket } from "mysql2/promise"
import { Tedis } from "tedis"

export interface RDSSecretValue {
    password: string
    dbname: string
    engine: string
    port: number
    dbInstanceIdentifier: string
    host: string
    username: string
}

export interface ConnectionManagerProps {
    rdsSecretArn: string
    redisEndpointAddress: string
    redisEndpointPort?: string
}

export class ConnectionManager {
    private readonly secretsManagerClient: SecretsManagerClient
    public static readonly REDIS_ZSET_NAME = "leaderboard"
    public static readonly REDIS_USER_CACHE_NAME = "users"
    
    private secret?: RDSSecretValue
    private rdsConnection?: mysql.Connection
    private redis?: Tedis

    private readonly connectionProperties: ConnectionManagerProps
    
    constructor(props: ConnectionManagerProps) {
        this.secretsManagerClient = new SecretsManagerClient()
        this.connectionProperties = props
    }

    public async cleanUp() {
        if (this.rdsConnection) {
            await this.rdsConnection.end()
            this.rdsConnection = undefined
        }

        if (this.redis) {
            this.redis.close()
            this.redis = undefined
        }
    }

    public async userExists(userId: string): Promise<boolean> {
        const rds = await this.getOrCreateRDSConnection()
        const rows = (await rds.execute("select count(*) as countof from users where id=?", [userId]))[0] as RowDataPacket[]

        return rows[0].countof > 0
    }

    public async getOrCreateRDSConnection(): Promise<mysql.Connection> {
        if (this.rdsConnection) {
            return this.rdsConnection
        } else {
            await this.populateSecret()
            this.rdsConnection = await mysql.createConnection({
                host: this.secret!.host,
                user: this.secret!.username,
                password: this.secret!.password,
                port: this.secret!.port,
                database: this.secret!.dbname
            })

            return this.rdsConnection
        }
    }

    public async initTables() {
        const rdsConn = await this.getOrCreateRDSConnection()
        await rdsConn.execute("create table if not exists users(id varchar(50) not null, username varchar(50) not null, primary key (id))")
        await rdsConn.execute("create table if not exists leaderboard(user_id varchar(50) not null, score double precision not null, key idx_score(score), key idx_user_id(user_id), constraint leaderboard_fk1 foreign key (user_id) references users(id) on delete cascade)")
        // await rdsConn.execute("truncate leaderboard")
        // await rdsConn.execute("truncate users")
    }

    public async dropTables() {
        const rdsConn = await this.getOrCreateRDSConnection()
        await rdsConn.execute("drop table if exists leaderboard")
        await rdsConn.execute("drop table if exists users")
    }

    public async getOrCreateRedisConnection(): Promise<Tedis> {
        if (this.redis) {
            return this.redis
        } else {
            this.redis = new Tedis({
                host: this.connectionProperties.redisEndpointAddress,
                port: parseInt(this.connectionProperties.redisEndpointPort || "6379")
            })

            return this.redis
        }
    }

    private async populateSecret(reload?: boolean) {
        if (reload) {
            this.secret = undefined
        }

        if (!this.secret) {
            const actualSecretResp = await this.secretsManagerClient.send(new GetSecretValueCommand({
                SecretId: this.connectionProperties.rdsSecretArn
            }))
    
            this.secret = JSON.parse(actualSecretResp.SecretString!)
        }
    }
}