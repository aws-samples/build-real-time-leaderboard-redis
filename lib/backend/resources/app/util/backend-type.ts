import { LeaderboardService, RdsLeaderboardService, RedisLeaderboardService } from "../leaderboard";
import { ConnectionManagerProps } from "./connection-manager";

export enum BackendType {
    REDIS = "redis",
    RDS = "rds"
}

export class BackendService {
    public static getLeaderboardService(props: ConnectionManagerProps, type: BackendType): LeaderboardService {
        if (type === BackendType.REDIS) {
            return new RedisLeaderboardService(props)
        } else if (type === BackendType.RDS) {
            return new RdsLeaderboardService(props)
        }

        throw new Error("Invalid backend type")
    }
}